namespace CyclesInsertHost;

/// <summary>
/// Tempo-synced volume dip on the master output. Division is in quarter-note beats.
/// Zero division leaves the buffer untouched.
/// </summary>
sealed class OutputDuck
{
    const double Floor = 0.06;
    const double Attack = 0.002;
    const double Hold = 0.016;
    readonly object _gate = new();
    double _division;
    double _bpm = 120;
    double _beats;
    bool _running;
    bool _haveBeat;
    bool _custom;
    int _trigs;

    public void Set(double division, double bpm, double beats, bool running, bool seek, bool custom, int trigs)
    {
        if (!double.IsFinite(division) || division < 0) division = 0;
        if (division > 8) division = 8;
        if (!double.IsFinite(bpm) || bpm < 20 || bpm > 400) bpm = 120;
        if (!double.IsFinite(beats)) beats = 0;
        if (trigs < 0) trigs = 0;
        lock (_gate)
        {
            var wasRunning = _running;
            var willRun = running && (custom || division > 0);
            if (seek)
            {
                var error = beats - _beats;
                // Enabling the rate lands on the current grid point instead of beat 0.
                if (!_haveBeat || (!wasRunning && willRun) || Math.Abs(error) >= 0.5)
                    _beats = beats;
                else
                    _beats += Math.Clamp(error, -0.03, 0.03);
                _haveBeat = true;
            }
            _division = division;
            _bpm = bpm;
            _running = willRun;
            _custom = custom;
            _trigs = trigs & 0xffff;
        }
    }

    public void Process(Span<float> output, int frames, int sampleRate)
    {
        if (frames <= 0 || sampleRate < 1000) return;
        if (output.Length < frames * 2) frames = output.Length / 2;
        if (frames <= 0) return;
        lock (_gate)
        {
            if (!_running) return;
            var step = _bpm / 60.0 / sampleRate;
            for (var n = 0; n < frames; n++)
            {
                var gain = _custom ? (float)CustomGain(_beats, _trigs, _bpm) : (float)Gain(_beats, _division, _bpm);
                var i = n * 2;
                output[i] *= gain;
                output[i + 1] *= gain;
                _beats += step;
            }
        }
    }

    static double Gain(double beats, double division, double bpm)
    {
        if (division <= 0 || bpm <= 0) return 1;
        var wrapped = beats % division;
        if (wrapped < 0) wrapped += division;
        var cycle = division * 60.0 / bpm;
        var seconds = wrapped * 60.0 / bpm;
        var attack = Math.Min(Attack, cycle * 0.08);
        var hold = Math.Min(Hold, Math.Max(0, cycle * 0.22 - attack));
        if (seconds <= attack)
        {
            var slope = attack > 0 ? seconds / attack : 1;
            return 1 - (1 - Floor) * slope;
        }
        if (seconds <= attack + hold) return Floor;
        var span = Math.Max(0.0001, cycle - attack - hold);
        var progress = Math.Min(1, (seconds - attack - hold) / span);
        var rise = Math.Sin(progress * Math.PI / 2);
        return Floor + (1 - Floor) * rise;
    }

    static double CustomGain(double beats, int trigs, double bpm)
    {
        var mask = trigs & 0xffff;
        if (mask == 0 || bpm <= 0) return 1;
        const double bar = 4;
        var wrapped = beats % bar;
        if (wrapped < 0) wrapped += bar;
        double first = 0;
        double last = 0;
        var any = false;
        for (var index = 0; index < 16; index++)
        {
            if ((mask & (1 << index)) == 0) continue;
            var at = index * 0.25;
            if (!any) first = at;
            last = at;
            any = true;
        }
        if (!any) return 1;
        var start = last - bar;
        var end = first + bar;
        for (var index = 0; index < 16; index++)
        {
            if ((mask & (1 << index)) == 0) continue;
            var at = index * 0.25;
            if (at <= wrapped + 1e-8) start = at;
            else
            {
                end = at;
                break;
            }
        }
        return Gain(wrapped - start, end - start, bpm);
    }
}
