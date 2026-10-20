namespace CyclesInsertHost;

/// <summary>
/// Reverse plays a frozen slice backward. The slice is 1, 2, 4, or 8 bars.
/// Tape stop winds the master down over one, two, or four beats,
/// holds silence, then winds back to the live signal.
/// </summary>
sealed class OutputMotion
{
    double _reverseBeats = 16;
    double _tapeBeats = 2;
    double _windBeats = 2;
    const int Idle = 0;
    const int Stopping = 1;
    const int Stopped = 2;
    const int Returning = 3;

    readonly object _gate = new();
    float[] _ring = [];
    float[] _dry = [];
    float[] _loop = [];
    int _capacity;
    int _sampleRate;
    int _write;
    int _filled;
    int _dryWrite;
    int _dryFilled;
    int _loopEpoch;
    int _loopFrames;
    int _cursor;
    bool _haveLoop;
    bool _capture;
    bool _reverse;
    bool _over;
    bool _tapeOver;
    bool _tape;
    int _phase = Idle;
    double _bpm = 120;
    double _progress;
    double _rate = 1;
    double _returnFrom = 1;
    double _read;

    public bool HoldsSilence
    {
        get
        {
            lock (_gate) return _phase == Stopped;
        }
    }

    /// <summary>
    /// Reverse is playing from the end of the chain, so the filter has to
    /// run after the slice or it only colors the moment of capture.
    /// </summary>
    public bool PlaysReverse
    {
        get
        {
            lock (_gate) return _reverse && !_over;
        }
    }

    public void Set(bool reverse, bool tape, double bpm, double reverseBeats, bool over, double tapeBeats, bool tapeOver)
    {
        if (!double.IsFinite(bpm) || bpm < 20 || bpm > 400) bpm = 120;
        if (reverseBeats != 4 && reverseBeats != 8 && reverseBeats != 16 && reverseBeats != 32) reverseBeats = 16;
        if (tapeBeats != 1 && tapeBeats != 2 && tapeBeats != 4) tapeBeats = 2;
        if (tape) reverse = false;
        lock (_gate)
        {
            var wasReverse = _reverse;
            var wasTape = _tape;
            var lengthChanged = Math.Abs(reverseBeats - _reverseBeats) > 0.01;
            var sourceChanged = over != _over;
            var tapeSourceChanged = tapeOver != _tapeOver;
            _bpm = bpm;
            _reverseBeats = reverseBeats;
            _tapeBeats = tapeBeats;
            _over = over;
            _tapeOver = tapeOver;
            _reverse = reverse;
            _tape = tape;
            if (reverse && (!wasReverse || lengthChanged || sourceChanged)) _capture = true;
            if (sourceChanged && reverse) _haveLoop = false;
            if (!reverse)
            {
                _haveLoop = false;
                _capture = false;
            }
            if (tape && !wasTape)
            {
                _phase = Stopping;
                _progress = 0;
                _rate = 1;
                _windBeats = _tapeBeats;
                var head = _tapeOver ? _dryWrite : _write;
                _read = head > 0 ? head - 1 : 0;
            }
            else if (tape && tapeSourceChanged)
            {
                var head = _tapeOver ? _dryWrite : _write;
                _read = head > 0 ? head - 1 : 0;
            }
            else if (!tape && wasTape)
            {
                _phase = Returning;
                _progress = 0;
                _returnFrom = _rate;
                _windBeats = _tapeBeats;
                var head = _tapeOver ? _dryWrite : _write;
                _read = head > 0 ? head - 1 : 0;
            }
            else if (!tape)
            {
                _phase = Idle;
                _rate = 1;
            }
        }
    }

    /// <summary>
    /// When effects sit on the reverse or the tape stop, shape the dry input
    /// before the inserts. Returns 0 when motion stays at the end of the chain,
    /// -1 while the dry reverse slice is still filling, -2 while tape leads,
    /// and the loop count once reverse is playing.
    /// </summary>
    public int Lead(ReadOnlySpan<float> input, Span<float> reversed, int frames, int sampleRate)
    {
        if (frames <= 0 || sampleRate < 1000) return 0;
        if (input.Length < frames * 2 || reversed.Length < frames * 2) return 0;
        lock (_gate)
        {
            if (!_over && !_tapeOver) return 0;
            Ensure(sampleRate);
            if (_tapeOver && _phase != Idle)
            {
                var step = _bpm / 60.0 / sampleRate;
                for (var n = 0; n < frames; n++)
                {
                    var i = n * 2;
                    var at = _dryWrite;
                    _dry[at * 2] = input[i];
                    _dry[at * 2 + 1] = input[i + 1];
                    _dryWrite++;
                    if (_dryWrite >= _capacity) _dryWrite = 0;
                    if (_dryFilled < _capacity) _dryFilled++;
                    reversed[i] = input[i];
                    reversed[i + 1] = input[i + 1];
                    PlayTape(_dry, _dryWrite, reversed, i, step);
                }
                return -2;
            }
            Record(_dry, ref _dryWrite, ref _dryFilled, input, frames);
            if (!_over || !_reverse) return 0;
            var span = SpanFrames(_reverseBeats);
            if (_capture && _dryFilled >= span && span >= 8)
            {
                CaptureFrom(_dry, _dryWrite, span);
                _capture = false;
            }
            if (!_haveLoop || _loopFrames <= 1)
            {
                input.Slice(0, frames * 2).CopyTo(reversed);
                return -1;
            }
            for (var n = 0; n < frames; n++) PlayReverse(reversed, n * 2);
            return _loopEpoch;
        }
    }

    public void Process(Span<float> output, int frames, int sampleRate)
    {
        if (frames <= 0 || sampleRate < 1000) return;
        if (output.Length < frames * 2) frames = output.Length / 2;
        if (frames <= 0) return;
        lock (_gate)
        {
            Ensure(sampleRate);
            if (_reverse && _capture && _filled >= SpanFrames(_reverseBeats) && SpanFrames(_reverseBeats) >= 8)
            {
                Capture(SpanFrames(_reverseBeats));
                _capture = false;
            }
            var step = _bpm / 60.0 / sampleRate;
            for (var n = 0; n < frames; n++)
            {
                var i = n * 2;
                var at = _write;
                _ring[at * 2] = output[i];
                _ring[at * 2 + 1] = output[i + 1];
                _write++;
                if (_write >= _capacity) _write = 0;
                if (_filled < _capacity) _filled++;

                if (_reverse && _haveLoop && _loopFrames > 1)
                {
                    PlayReverse(output, i);
                    continue;
                }
                if (_phase == Stopped)
                {
                    output[i] = 0;
                    output[i + 1] = 0;
                    continue;
                }
                if (_phase == Idle || _tapeOver) continue;
                PlayTape(_ring, _write, output, i, step);
            }
        }
    }

    void PlayReverse(Span<float> output, int i)
    {
        var read = _cursor;
        var fade = Math.Min(16, _loopFrames / 16);
        if (fade > 1 && read < fade)
        {
            var mix = (fade - read) / (float)fade;
            var end = read * 2;
            var start = (_loopFrames - 1) * 2;
            output[i] = _loop[end] * (1 - mix) + _loop[start] * mix;
            output[i + 1] = _loop[end + 1] * (1 - mix) + _loop[start + 1] * mix;
        }
        else
        {
            var src = read * 2;
            output[i] = _loop[src];
            output[i + 1] = _loop[src + 1];
        }
        _cursor--;
        if (_cursor < 0) _cursor = _loopFrames - 1;
    }

    void PlayTape(float[] ring, int write, Span<float> output, int i, double step)
    {
        if (_phase == Stopped)
        {
            output[i] = 0;
            output[i + 1] = 0;
            return;
        }
        var span = _windBeats;
        _progress += step;
        var t = _progress / span;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        if (_phase == Stopping)
        {
            _rate = Math.Cos(t * Math.PI / 2);
            if (t >= 1)
            {
                _phase = Stopped;
                _rate = 0;
                output[i] = 0;
                output[i + 1] = 0;
                return;
            }
            Sample(ring, _read, out var left, out var right);
            output[i] = left;
            output[i + 1] = right;
            Advance(_rate);
            return;
        }
        _rate = _returnFrom + (1 - _returnFrom) * Math.Sin(t * Math.PI / 2);
        Sample(ring, _read, out var wetL, out var wetR);
        var mix = (float)t;
        output[i] = wetL * (1 - mix) + output[i] * mix;
        output[i + 1] = wetR * (1 - mix) + output[i + 1] * mix;
        var gap = write - _read;
        if (gap < 0) gap += _capacity;
        var leftBeats = Math.Max(0.0001, span - _progress);
        var catchUp = gap * step / leftBeats;
        var amount = _rate + catchUp;
        if (amount > gap - 1) amount = Math.Max(0, gap - 1);
        Advance(amount);
        if (t >= 1)
        {
            _phase = Idle;
            _rate = 1;
        }
    }

    void Sample(float[] ring, double frame, out float left, out float right)
    {
        var i0 = (int)Math.Floor(frame);
        var frac = (float)(frame - i0);
        var a = Wrap(i0);
        var b = Wrap(i0 + 1);
        left = ring[a * 2] * (1 - frac) + ring[b * 2] * frac;
        right = ring[a * 2 + 1] * (1 - frac) + ring[b * 2 + 1] * frac;
    }

    void Advance(double amount)
    {
        if (_capacity <= 0) return;
        _read += amount;
        while (_read >= _capacity) _read -= _capacity;
        while (_read < 0) _read += _capacity;
    }

    int Wrap(int frame)
    {
        var wrapped = frame % _capacity;
        if (wrapped < 0) wrapped += _capacity;
        return wrapped;
    }

    void Ensure(int sampleRate)
    {
        // Eight bars at the slowest accepted tempo is 96 seconds.
        var frames = sampleRate * 96;
        if (_capacity == frames && _sampleRate == sampleRate) return;
        _sampleRate = sampleRate;
        _capacity = frames;
        _ring = new float[frames * 2];
        _dry = new float[frames * 2];
        _loop = new float[frames * 2];
        _write = 0;
        _filled = 0;
        _dryWrite = 0;
        _dryFilled = 0;
        _read = 0;
        _haveLoop = false;
        _capture = _reverse;
    }

    void Record(float[] ring, ref int write, ref int filled, ReadOnlySpan<float> input, int frames)
    {
        for (var n = 0; n < frames; n++)
        {
            var i = n * 2;
            ring[write * 2] = input[i];
            ring[write * 2 + 1] = input[i + 1];
            write++;
            if (write >= _capacity) write = 0;
            if (filled < _capacity) filled++;
        }
    }

    void Capture(int loopFrames) => CaptureFrom(_ring, _write, loopFrames);

    void CaptureFrom(float[] ring, int write, int loopFrames)
    {
        for (var i = 0; i < loopFrames; i++)
        {
            var ago = loopFrames - 1 - i;
            var frame = write - 1 - ago;
            var wrapped = frame % _capacity;
            if (wrapped < 0) wrapped += _capacity;
            _loop[i * 2] = ring[wrapped * 2];
            _loop[i * 2 + 1] = ring[wrapped * 2 + 1];
        }
        _loopFrames = loopFrames;
        _cursor = loopFrames - 1;
        _haveLoop = true;
        _loopEpoch++;
    }

    int SpanFrames(double beats)
    {
        if (beats <= 0 || _bpm <= 0 || _sampleRate < 1000 || _capacity < 8) return 0;
        var frames = (int)(beats * 60.0 / _bpm * _sampleRate);
        if (frames < 8) return 8;
        var cap = _capacity - 1;
        return frames > cap ? cap : frames;
    }
}
