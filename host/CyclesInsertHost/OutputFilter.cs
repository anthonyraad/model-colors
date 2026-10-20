using System.Diagnostics;

namespace CyclesInsertHost;

/// <summary>
/// Stereo lowpass and highpass on the master output.
/// 12 dB is one biquad. 24 dB cascades a second. None is Butterworth.
/// Position -1 is a closed lowpass, 0 is a true bypass, and +1 is a strong highpass.
/// The audio thread owns the ramp so a held key does not depend on key repeat.
/// </summary>
sealed class OutputFilter
{
    const double TravelSeconds = 2.25;
    const double Butterworth = 0.7071067811865476;
    const int Hold = 0;
    const int High = 1;
    const int Low = 2;
    const int OpenHigh = 3;
    const int OpenLow = 4;
    const int Reset = 5;
    const int Return = 6;

    readonly object _gate = new();
    long _origin = Stopwatch.GetTimestamp();
    bool _live;
    int _move = Hold;
    float _position;
    float _returnFrom;
    double _returnWait;
    double _returnSpan;
    double _returnElapsed;
    int _slope = 12;
    double _q = Butterworth;

    float _hz = 20;
    float _mix;
    bool _highpass = true;
    double _b0 = 1;
    double _b1;
    double _b2;
    double _a1;
    double _a2;
    double _2b0 = 1;
    double _2b1;
    double _2b2;
    double _2a1;
    double _2a2;
    double _lx1, _lx2, _ly1, _ly2;
    double _rx1, _rx2, _ry1, _ry2;
    double _2lx1, _2lx2, _2ly1, _2ly2;
    double _2rx1, _2rx2, _2ry1, _2ry2;

    public void SetMove(string? name, bool hasPosition, float position, bool returning = false, double wait = 0, double span = 0)
    {
        var move = Parse(name);
        lock (_gate)
        {
            if (!_live) Integrate();
            if (move == Return || returning)
            {
                if (hasPosition && float.IsFinite(position)) _position = Math.Clamp(position, -1f, 1f);
                _returnFrom = _position;
                _returnWait = double.IsFinite(wait) && wait > 0 ? wait : 0;
                _returnSpan = double.IsFinite(span) && span > 0 ? span : 0;
                _returnElapsed = 0;
                if (_returnWait <= 0 && _returnSpan <= 0)
                {
                    _position = 0;
                    _move = Hold;
                }
                else _move = Return;
            }
            else if (hasPosition && float.IsFinite(position))
            {
                _position = Math.Clamp(position, -1f, 1f);
                _move = move == Reset ? Hold : move;
            }
            else if (move == OpenHigh)
            {
                _position = 1;
                _move = OpenHigh;
            }
            else if (move == OpenLow)
            {
                _position = -1;
                _move = OpenLow;
            }
            else if (move == Reset)
            {
                _position = 0;
                _move = Hold;
            }
            else
            {
                _move = move;
            }
            _origin = Stopwatch.GetTimestamp();
        }
    }

    public void SetShape(int slope, double q)
    {
        if (!double.IsFinite(q) || q < 0.5 || q > 12) q = Butterworth;
        lock (_gate)
        {
            _slope = slope >= 24 ? 24 : 12;
            _q = q;
        }
    }

    public void SetLive(bool live)
    {
        lock (_gate)
        {
            if (_live == live) return;
            if (!live)
            {
                _live = false;
                _origin = Stopwatch.GetTimestamp();
            }
        }
    }

    public void Process(Span<float> output, int frames, int sampleRate)
    {
        if (frames <= 0 || sampleRate < 1000) return;
        if (output.Length < frames * 2) frames = output.Length / 2;
        if (frames <= 0) return;
        float position;
        int slope;
        double q;
        lock (_gate)
        {
            if (!_live)
            {
                Integrate();
                _live = true;
            }
            else
            {
                Advance(frames / (double)sampleRate);
            }
            _origin = Stopwatch.GetTimestamp();
            position = _position;
            slope = _slope;
            q = _q;
        }
        Shape(output, frames, position, sampleRate, slope, q);
    }

    void Integrate()
    {
        var now = Stopwatch.GetTimestamp();
        var seconds = (now - _origin) / (double)Stopwatch.Frequency;
        if (seconds < 0) seconds = 0;
        if (seconds > 8) seconds = 8;
        Advance(seconds);
        _origin = now;
    }

    void Advance(double seconds)
    {
        if (seconds <= 0) return;
        if (_move == Return)
        {
            _returnElapsed += seconds;
            if (_returnElapsed < _returnWait)
            {
                _position = _returnFrom;
                return;
            }
            if (_returnSpan <= 0 || _returnElapsed >= _returnWait + _returnSpan)
            {
                _position = 0;
                _move = Hold;
                return;
            }
            var along = (_returnElapsed - _returnWait) / _returnSpan;
            _position = (float)(_returnFrom * (1 - along));
            return;
        }
        var distance = (float)(seconds / TravelSeconds);
        _position = _move switch
        {
            High => Math.Min(1f, _position + distance),
            Low => Math.Max(-1f, _position - distance),
            OpenHigh => Math.Max(0f, _position - distance),
            OpenLow => Math.Min(0f, _position + distance),
            _ => _position
        };
    }

    void Shape(Span<float> output, int frames, float position, int sampleRate, int slope, double q)
    {
        var bypass = position > -0.0001f && position < 0.0001f;
        if (bypass && _mix < 0.0008f)
        {
            _mix = 0;
            Clear();
            return;
        }
        var highpass = _highpass;
        float targetHz;
        if (bypass)
        {
            targetHz = _hz;
        }
        else
        {
            highpass = position > 0;
            if (_mix < 0.0008f || highpass != _highpass)
            {
                Clear();
                _hz = highpass ? 20f : (float)Math.Min(18000.0, sampleRate * 0.45);
            }
            targetHz = Cutoff(position, sampleRate, highpass);
            _highpass = highpass;
        }
        var targetMix = bypass ? 0f : 1f;
        if (slope < 24)
        {
            _2lx1 = _2lx2 = _2ly1 = _2ly2 = 0;
            _2rx1 = _2rx2 = _2ry1 = _2ry2 = 0;
        }
        var tau = 0.006 * sampleRate;
        var index = 0;
        while (index < frames)
        {
            var count = Math.Min(32, frames - index);
            var keep = Math.Exp(-count / tau);
            _hz = (float)(targetHz + (_hz - targetHz) * keep);
            var mix0 = _mix;
            _mix = (float)(targetMix + (_mix - targetMix) * keep);
            Design(_hz, sampleRate, _highpass, q, slope);
            Mix(output, index, count, mix0, _mix, slope >= 24);
            index += count;
        }
        if (bypass && _mix < 0.0008f)
        {
            _mix = 0;
            Clear();
        }
    }

    static float Cutoff(float position, int sampleRate, bool highpass)
    {
        var nyquist = sampleRate * 0.45;
        if (highpass)
        {
            var hz = 20.0 * Math.Pow(10000.0 / 20.0, Math.Clamp(position, 0f, 1f));
            return (float)Math.Min(nyquist, hz);
        }
        var open = Math.Min(18000.0, nyquist);
        var amount = Math.Clamp(-position, 0f, 1f);
        var hzLow = open * Math.Pow(100.0 / open, amount);
        return (float)Math.Min(nyquist, Math.Max(20.0, hzLow));
    }

    void Design(float hz, int sampleRate, bool highpass, double q, int slope)
    {
        Sections(slope, q, out var q1, out var q2);
        Section(hz, sampleRate, highpass, q1, out _b0, out _b1, out _b2, out _a1, out _a2);
        if (slope >= 24)
            Section(hz, sampleRate, highpass, q2, out _2b0, out _2b1, out _2b2, out _2a1, out _2a2);
    }

    static void Sections(int slope, double q, out double q1, out double q2)
    {
        if (slope < 24)
        {
            q1 = q;
            q2 = Butterworth;
            return;
        }
        if (Math.Abs(q - Butterworth) < 0.02)
        {
            q1 = 0.541196100146197;
            q2 = 1.3065629648763766;
            return;
        }
        q1 = q;
        q2 = Butterworth;
    }

    static void Section(float hz, int sampleRate, bool highpass, double q, out double b0, out double b1, out double b2, out double a1, out double a2)
    {
        var nyquist = sampleRate * 0.45f;
        if (hz < 10) hz = 10;
        if (hz > nyquist) hz = nyquist;
        var w0 = 2 * Math.PI * hz / sampleRate;
        var cos = Math.Cos(w0);
        var alpha = Math.Sin(w0) / (2 * q);
        double raw0, raw1, raw2;
        if (highpass)
        {
            raw0 = (1 + cos) / 2;
            raw1 = -(1 + cos);
            raw2 = (1 + cos) / 2;
        }
        else
        {
            raw0 = (1 - cos) / 2;
            raw1 = 1 - cos;
            raw2 = (1 - cos) / 2;
        }
        var a0 = 1 + alpha;
        b0 = raw0 / a0;
        b1 = raw1 / a0;
        b2 = raw2 / a0;
        a1 = (-2 * cos) / a0;
        a2 = (1 - alpha) / a0;
    }

    void Mix(Span<float> output, int frame, int count, float mix0, float mix1, bool second)
    {
        for (var n = 0; n < count; n++)
        {
            var i = (frame + n) * 2;
            var xL = output[i];
            var xR = output[i + 1];
            var yL = _b0 * xL + _b1 * _lx1 + _b2 * _lx2 - _a1 * _ly1 - _a2 * _ly2;
            var yR = _b0 * xR + _b1 * _rx1 + _b2 * _rx2 - _a1 * _ry1 - _a2 * _ry2;
            if (yL is > -1e-15 and < 1e-15) yL = 0;
            if (yR is > -1e-15 and < 1e-15) yR = 0;
            _lx2 = _lx1;
            _lx1 = xL;
            _ly2 = _ly1;
            _ly1 = yL;
            _rx2 = _rx1;
            _rx1 = xR;
            _ry2 = _ry1;
            _ry1 = yR;
            if (second)
            {
                var zL = _2b0 * yL + _2b1 * _2lx1 + _2b2 * _2lx2 - _2a1 * _2ly1 - _2a2 * _2ly2;
                var zR = _2b0 * yR + _2b1 * _2rx1 + _2b2 * _2rx2 - _2a1 * _2ry1 - _2a2 * _2ry2;
                if (zL is > -1e-15 and < 1e-15) zL = 0;
                if (zR is > -1e-15 and < 1e-15) zR = 0;
                _2lx2 = _2lx1;
                _2lx1 = yL;
                _2ly2 = _2ly1;
                _2ly1 = zL;
                _2rx2 = _2rx1;
                _2rx1 = yR;
                _2ry2 = _2ry1;
                _2ry1 = zR;
                yL = zL;
                yR = zR;
            }
            var mix = count <= 1 ? mix1 : mix0 + (mix1 - mix0) * n / (count - 1);
            var keep = 1 - mix;
            output[i] = (float)(xL * keep + yL * mix);
            output[i + 1] = (float)(xR * keep + yR * mix);
        }
    }

    void Clear()
    {
        _lx1 = _lx2 = _ly1 = _ly2 = 0;
        _rx1 = _rx2 = _ry1 = _ry2 = 0;
        _2lx1 = _2lx2 = _2ly1 = _2ly2 = 0;
        _2rx1 = _2rx2 = _2ry1 = _2ry2 = 0;
    }

    static int Parse(string? name) => name switch
    {
        "high" => High,
        "low" => Low,
        "open-high" => OpenHigh,
        "open-low" => OpenLow,
        "reset" => Reset,
        "return" => Return,
        _ => Hold
    };
}
