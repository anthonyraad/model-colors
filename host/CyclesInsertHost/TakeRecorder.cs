using System.Buffers;
using System.Text;

namespace CyclesInsertHost;

/// <summary>
/// Captures the master output as 32-bit float stereo, after inserts and performance effects.
/// </summary>
sealed class TakeRecorder
{
    readonly object _gate = new();
    readonly List<Chunk> _chunks = new();
    int _rate = 48000;
    int _samples;
    volatile bool _armed;

    public void Begin(int sampleRate)
    {
        Discard();
        if (sampleRate < 1000) sampleRate = 48000;
        lock (_gate)
        {
            _rate = sampleRate;
            _armed = true;
        }
    }

    public void Append(ReadOnlySpan<float> interleaved)
    {
        if (!_armed || interleaved.Length == 0) return;
        var rented = ArrayPool<float>.Shared.Rent(interleaved.Length);
        interleaved.CopyTo(rented);
        lock (_gate)
        {
            if (!_armed)
            {
                ArrayPool<float>.Shared.Return(rented);
                return;
            }
            _chunks.Add(new Chunk(rented, interleaved.Length));
            _samples += interleaved.Length;
            if (_samples / 2.0 / _rate >= 90 * 60) _armed = false;
        }
    }

    public double End()
    {
        lock (_gate)
        {
            _armed = false;
            if (_samples < 2 || _rate < 1000) return 0;
            return _samples / 2.0 / _rate;
        }
    }

    public void Discard()
    {
        Chunk[] leftover;
        lock (_gate)
        {
            _armed = false;
            leftover = _chunks.ToArray();
            _chunks.Clear();
            _samples = 0;
        }
        foreach (var chunk in leftover) ArrayPool<float>.Shared.Return(chunk.Buffer);
    }

    public string Save(string path)
    {
        Chunk[] chunks;
        int rate;
        int samples;
        lock (_gate)
        {
            if (_armed) return "Stop the recording before saving.";
            if (_samples < 2) return "Nothing was captured.";
            if ((long)_samples * 4 > int.MaxValue - 64) return "That recording is too long to save as a wav file.";
            chunks = _chunks.ToArray();
            rate = _rate;
            samples = _samples;
        }
        try
        {
            WriteWav(path, rate, samples, chunks);
        }
        catch (Exception error)
        {
            return string.IsNullOrWhiteSpace(error.Message) ? "Could not save the recording." : error.Message;
        }
        Discard();
        return "";
    }

    static void WriteWav(string path, int sampleRate, int samples, Chunk[] chunks)
    {
        var dataBytes = samples * 4;
        var frames = samples / 2;
        using var stream = File.Create(path);
        using var writer = new BinaryWriter(stream);
        writer.Write(Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(48 + dataBytes);
        writer.Write(Encoding.ASCII.GetBytes("WAVE"));
        writer.Write(Encoding.ASCII.GetBytes("fmt "));
        writer.Write(16);
        writer.Write((short)3);
        writer.Write((short)2);
        writer.Write(sampleRate);
        writer.Write(sampleRate * 8);
        writer.Write((short)8);
        writer.Write((short)32);
        writer.Write(Encoding.ASCII.GetBytes("fact"));
        writer.Write(4);
        writer.Write(frames);
        writer.Write(Encoding.ASCII.GetBytes("data"));
        writer.Write(dataBytes);
        var written = 0;
        foreach (var chunk in chunks)
        {
            var count = Math.Min(chunk.Length, samples - written);
            for (var i = 0; i < count; i++) writer.Write(chunk.Buffer[i]);
            written += count;
            if (written >= samples) break;
        }
    }

    readonly record struct Chunk(float[] Buffer, int Length);
}
