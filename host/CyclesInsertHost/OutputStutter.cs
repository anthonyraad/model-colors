namespace CyclesInsertHost;

/// <summary>
/// Tempo-synced beat repeat on the master output. Division is in quarter-note beats.
/// The first slice is frozen and repeated until the rate is cleared or changed.
/// </summary>
sealed class OutputStutter
{
    readonly object _gate = new();
    float[] _ring = [];
    float[] _loop = [];
    int _capacity;
    int _write;
    int _filled;
    int _loopFrames;
    int _cursor;
    bool _haveLoop;
    bool _capture = true;
    double _division;
    double _bpm = 120;
    double _beats;
    bool _running;
    bool _haveBeat;
    bool _custom;
    int _trigs;
    double _segment = double.NaN;

    public void Set(double division, double bpm, double beats, bool running, bool seek, bool custom, int trigs)
    {
        if (!double.IsFinite(division) || division < 0) division = 0;
        if (division > 1) division = 1;
        if (!double.IsFinite(bpm) || bpm < 20 || bpm > 400) bpm = 120;
        if (!double.IsFinite(beats)) beats = 0;
        lock (_gate)
        {
            var wasRunning = _running;
            var willRun = running && (custom || division > 0);
            if (seek)
            {
                var error = beats - _beats;
                if (!_haveBeat || (!wasRunning && willRun) || Math.Abs(error) >= 0.5)
                    _beats = beats;
                else
                    _beats += Math.Clamp(error, -0.03, 0.03);
                _haveBeat = true;
            }
            // A new rate, or turning one on, freezes a fresh fragment. Tempo drift and step edits do not.
            var divisionChanged = !custom && Math.Abs(division - _division) > 0.0001;
            if (willRun && (!wasRunning || divisionChanged || custom != _custom))
                _capture = true;
            if (!willRun)
            {
                _haveLoop = false;
                _segment = double.NaN;
            }
            _division = division;
            _bpm = bpm;
            _running = willRun;
            _custom = custom;
            _trigs = trigs;
        }
    }

    /// <summary>Drop the frozen slice so the next one comes from the audio playing now.</summary>
    public void Renew()
    {
        lock (_gate)
        {
            if (!_running) return;
            _capture = true;
            _haveLoop = false;
            _filled = 0;
            _segment = double.NaN;
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
            var loopFrames = _custom ? 0 : LoopFrames(_division, _bpm, sampleRate);
            if (_running && _custom && _trigs != 0 && Span(_beats, _trigs, out _, out var captureSpan))
                loopFrames = LoopFrames(captureSpan, _bpm, sampleRate);
            if (_running && _capture && _filled >= loopFrames && loopFrames >= 8)
            {
                Capture(loopFrames);
                _capture = false;
            }
            var step = _bpm / 60.0 / sampleRate;
            for (var n = 0; n < frames; n++)
            {
                var at = _write;
                var i = n * 2;
                _ring[at * 2] = output[i];
                _ring[at * 2 + 1] = output[i + 1];
                _write++;
                if (_write >= _capacity) _write = 0;
                if (_filled < _capacity) _filled++;
                var play = _running && _haveLoop && _loopFrames > 1;
                if (play && _custom)
                {
                    if (!Span(_beats, _trigs, out var start, out _)) play = false;
                    else if (double.IsNaN(_segment) || Math.Abs(start - _segment) > 0.01)
                    {
                        _segment = start;
                        _cursor = 0;
                    }
                }
                if (play)
                {
                    var read = _cursor;
                    var fade = Math.Min(16, _loopFrames / 16);
                    if (fade > 1 && read >= _loopFrames - fade)
                    {
                        var mix = (read - (_loopFrames - fade) + 1) / (float)fade;
                        var end = read * 2;
                        output[i] = _loop[end] * (1 - mix) + _loop[0] * mix;
                        output[i + 1] = _loop[end + 1] * (1 - mix) + _loop[1] * mix;
                    }
                    else
                    {
                        var src = read * 2;
                        output[i] = _loop[src];
                        output[i + 1] = _loop[src + 1];
                    }
                    _cursor++;
                    if (_cursor >= _loopFrames) _cursor = 0;
                }
                if (_running) _beats += step;
            }
        }
    }

    void Ensure(int sampleRate)
    {
        var frames = sampleRate * 4;
        if (_capacity == frames) return;
        _capacity = frames;
        _ring = new float[frames * 2];
        _loop = new float[frames * 2];
        _write = 0;
        _filled = 0;
        _haveLoop = false;
        _capture = true;
    }

    void Capture(int loopFrames)
    {
        for (var i = 0; i < loopFrames; i++)
        {
            var ago = loopFrames - 1 - i;
            var frame = _write - 1 - ago;
            var wrapped = frame % _capacity;
            if (wrapped < 0) wrapped += _capacity;
            _loop[i * 2] = _ring[wrapped * 2];
            _loop[i * 2 + 1] = _ring[wrapped * 2 + 1];
        }
        _loopFrames = loopFrames;
        _cursor = 0;
        _haveLoop = true;
    }

    static int LoopFrames(double division, double bpm, int sampleRate)
    {
        if (division <= 0 || bpm <= 0) return 0;
        var frames = (int)(division * 60.0 / bpm * sampleRate);
        if (frames < 8) return 8;
        var cap = sampleRate * 4 - 1;
        return frames > cap ? cap : frames;
    }

    static bool Span(double beats, int trigs, out double start, out double span)
    {
        start = 0;
        span = 0;
        if (trigs == 0) return false;
        const double bar = 4;
        var wrapped = beats % bar;
        if (wrapped < 0) wrapped += bar;
        double first = 0;
        double last = 0;
        var any = false;
        for (var index = 0; index < 32; index++)
        {
            if ((trigs & (1 << index)) == 0) continue;
            var at = index * 0.125;
            if (!any) first = at;
            last = at;
            any = true;
        }
        if (!any) return false;
        start = last - bar;
        var end = first + bar;
        for (var index = 0; index < 32; index++)
        {
            if ((trigs & (1 << index)) == 0) continue;
            var at = index * 0.125;
            if (at <= wrapped + 1e-8) start = at;
            else
            {
                end = at;
                break;
            }
        }
        span = end - start;
        return span > 0;
    }
}
