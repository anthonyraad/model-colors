using System.Runtime.InteropServices;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Vst3;
using NAudio.Wave;

namespace CyclesInsertHost;

/// <summary>
/// Master chain for the Model:Cycles. A six-channel USB stream is six mono stems,
/// mixed here for the speakers. Up to six VST3 inserts sit on that mix.
/// One JSON command per stdin line. Stem levels are extra lines and are not replies.
/// </summary>
public static class Program
{
    static readonly Engine Engine = new();
    static readonly object WriteLock = new();

    [STAThread]
    public static void Main()
    {
        Console.InputEncoding = System.Text.Encoding.UTF8;
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        UiThread.Run(ReadCommands);
    }

    static void ReadCommands()
    {
        Reply(new { ok = true, kind = "ready" });
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line.Trim().Length == 0) continue;
            try
            {
                Handle(line);
            }
            catch (Exception error)
            {
                Reply(new { ok = false, kind = "error", message = error.Message });
            }
        }
        Engine.Shutdown();
        UiThread.Quit();
    }

    static void Handle(string line)
    {
        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        var command = root.TryGetProperty("cmd", out var cmd) ? cmd.GetString() : null;
        switch (command)
        {
            case "devices":
                Reply(new { ok = true, kind = "devices", inputs = Engine.Devices(DataFlow.Capture), outputs = Engine.Devices(DataFlow.Render) });
                break;
            case "plugins":
                Reply(new { ok = true, kind = "plugins", plugins = Engine.Plugins() });
                break;
            case "start":
                Engine.Start(
                    Text(root, "inputId"),
                    Text(root, "outputId"),
                    Slots(root),
                    Tempo(root),
                    Text(root, "filter"),
                    Number(root, "position", out var startPosition),
                    (float)startPosition,
                    Number(root, "wait", out var filterWait) & Number(root, "span", out var filterSpan),
                    filterWait,
                    filterSpan,
                    Whole(root, "filterSlope"),
                    Number(root, "filterQ", out var filterQ) ? filterQ : 0.7071067811865476,
                    Number(root, "duck", out var duckDivision),
                    duckDivision,
                    Number(root, "duckBpm", out var duckBpm) ? duckBpm : 120,
                    Number(root, "duckBeats", out var duckBeats) ? duckBeats : 0,
                    root.TryGetProperty("duckRunning", out var duckRun) && duckRun.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("duckSeek", out var duckSeek) && duckSeek.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("duckCustom", out var duckCustom) && duckCustom.ValueKind == JsonValueKind.True,
                    Whole(root, "duckTrigs"),
                    Number(root, "stutter", out var stutterDivision),
                    stutterDivision,
                    Number(root, "stutterBpm", out var stutterBpm) ? stutterBpm : 120,
                    Number(root, "stutterBeats", out var stutterBeats) ? stutterBeats : 0,
                    root.TryGetProperty("stutterRunning", out var stutterRun) && stutterRun.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("stutterSeek", out var stutterSeek) && stutterSeek.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("stutterCustom", out var stutterCustom) && stutterCustom.ValueKind == JsonValueKind.True,
                    Whole(root, "stutterTrigs"),
                    root.TryGetProperty("motionReverse", out var motionReverse) && motionReverse.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("motionTape", out var motionTape) && motionTape.ValueKind == JsonValueKind.True,
                    Number(root, "motionBpm", out var motionBpm) ? motionBpm : 120,
                    Number(root, "motionBeats", out var motionBeats) ? motionBeats : 16,
                    root.TryGetProperty("motionOver", out var motionOver) && motionOver.ValueKind == JsonValueKind.True,
                    Number(root, "motionTapeBeats", out var motionTapeBeats) ? motionTapeBeats : 2,
                    root.TryGetProperty("motionTapeOver", out var motionTapeOver) && motionTapeOver.ValueKind == JsonValueKind.True);
                Reply(new { ok = true, kind = "running", message = Engine.Status });
                break;
            case "stop":
                Engine.StopAudio();
                Reply(new { ok = true, kind = "stopped", message = "Playback through the inserts is stopped. Plug-in windows stay open." });
                break;
            case "editor":
                Engine.OpenEditor(Text(root, "path"), Text(root, "inputId"));
                Reply(new { ok = true, kind = "editor", message = Engine.Status });
                break;
            case "filter":
                Engine.SetFilter(
                    Text(root, "move"),
                    Number(root, "position", out var position),
                    (float)position,
                    Number(root, "wait", out var wait) & Number(root, "span", out var span),
                    wait,
                    span);
                Reply(new { ok = true, kind = "filter" });
                break;
            case "filter-shape":
                Engine.SetFilterShape(
                    Whole(root, "slope"),
                    Number(root, "q", out var shapeQ) ? shapeQ : 0.7071067811865476);
                Reply(new { ok = true, kind = "filter-shape" });
                break;
            case "duck":
                Engine.SetDuck(
                    Number(root, "division", out var division) ? division : 0,
                    Number(root, "bpm", out var duckTempo) ? duckTempo : 120,
                    Number(root, "beats", out var beats) ? beats : 0,
                    root.TryGetProperty("running", out var running) && running.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("seek", out var seek) && seek.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("custom", out var custom) && custom.ValueKind == JsonValueKind.True,
                    Whole(root, "trigs"));
                Reply(new { ok = true, kind = "duck" });
                break;
            case "stutter":
                Engine.SetStutter(
                    Number(root, "division", out var stutterDivisionCmd) ? stutterDivisionCmd : 0,
                    Number(root, "bpm", out var stutterTempo) ? stutterTempo : 120,
                    Number(root, "beats", out var stutterBeatCmd) ? stutterBeatCmd : 0,
                    root.TryGetProperty("running", out var stutterRunning) && stutterRunning.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("seek", out var stutterSeekCmd) && stutterSeekCmd.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("custom", out var stutterCustomCmd) && stutterCustomCmd.ValueKind == JsonValueKind.True,
                    Whole(root, "trigs"));
                Reply(new { ok = true, kind = "stutter" });
                break;
            case "states":
                Reply(new { ok = true, kind = "states", states = Engine.SlotStates() });
                break;
            case "restore":
                Engine.RestoreStates(States(root));
                Reply(new { ok = true, kind = "restore", message = "Plug-in settings restored." });
                break;
            case "motion":
                Engine.SetMotion(
                    root.TryGetProperty("reverse", out var motionReverseCmd) && motionReverseCmd.ValueKind == JsonValueKind.True,
                    root.TryGetProperty("tape", out var motionTapeCmd) && motionTapeCmd.ValueKind == JsonValueKind.True,
                    Number(root, "bpm", out var motionTempo) ? motionTempo : 120,
                    Number(root, "beats", out var motionBeatCmd) ? motionBeatCmd : 16,
                    root.TryGetProperty("over", out var motionOverCmd) && motionOverCmd.ValueKind == JsonValueKind.True,
                    Number(root, "tapeBeats", out var motionTapeBeatCmd) ? motionTapeBeatCmd : 2,
                    root.TryGetProperty("tapeOver", out var motionTapeOverCmd) && motionTapeOverCmd.ValueKind == JsonValueKind.True);
                Reply(new { ok = true, kind = "motion" });
                break;
            case "record-start":
                var recordStart = Engine.BeginTake();
                Reply(recordStart.Length == 0
                    ? new { ok = true, kind = "record-start", message = "Recording." }
                    : new { ok = false, kind = "record-start", message = recordStart });
                break;
            case "record-stop":
                var recordSeconds = Engine.EndTake();
                Reply(recordSeconds > 0
                    ? new { ok = true, kind = "record-stop", message = "Recording stopped.", seconds = recordSeconds }
                    : new { ok = false, kind = "record-stop", message = "Nothing was captured. Play through the inserts, then record." });
                break;
            case "record-save":
                var recordSaved = Engine.SaveTake(Text(root, "path"));
                Reply(recordSaved.Length == 0
                    ? new { ok = true, kind = "record-save", message = "Saved the recording." }
                    : new { ok = false, kind = "record-save", message = recordSaved });
                break;
            case "record-discard":
                Engine.DiscardTake();
                Reply(new { ok = true, kind = "record-discard", message = "Recording discarded." });
                break;
            case "quit":
                Engine.Shutdown();
                Reply(new { ok = true, kind = "bye" });
                UiThread.Quit();
                break;
            default:
                Reply(new { ok = false, kind = "error", message = "Unknown command." });
                break;
        }
    }

    static string? Text(JsonElement root, string name)
    {
        return root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    static List<SlotRequest> Slots(JsonElement root)
    {
        var slots = new List<SlotRequest>();
        if (!root.TryGetProperty("slots", out var list) || list.ValueKind != JsonValueKind.Array) return slots;
        foreach (var item in list.EnumerateArray())
        {
            if (slots.Count >= 6) break;
            var path = item.TryGetProperty("path", out var pathValue) && pathValue.ValueKind == JsonValueKind.String ? pathValue.GetString() : null;
            var bypass = item.TryGetProperty("bypass", out var bypassValue) && bypassValue.ValueKind == JsonValueKind.True;
            var fade = 0;
            var fadeOut = 0;
            if (item.TryGetProperty("fadeBars", out var fadeValue) && fadeValue.TryGetInt32(out var parsed))
                fade = parsed is 1 or 2 or 4 ? parsed : 0;
            if (item.TryGetProperty("fadeOutBars", out var fadeOutValue) && fadeOutValue.TryGetInt32(out var parsedOut))
                fadeOut = parsedOut is 1 or 2 or 4 ? parsedOut : 0;
            slots.Add(new SlotRequest(path, bypass, fade, fadeOut));
        }
        return slots;
    }

    static string?[] States(JsonElement root)
    {
        var states = new List<string?>();
        if (!root.TryGetProperty("states", out var list) || list.ValueKind != JsonValueKind.Array) return [];
        foreach (var item in list.EnumerateArray())
        {
            if (states.Count >= 6) break;
            states.Add(item.ValueKind == JsonValueKind.String ? item.GetString() : null);
        }
        return states.ToArray();
    }

    static double Tempo(JsonElement root)
    {
        if (root.TryGetProperty("tempo", out var value) && value.TryGetDouble(out var bpm) && bpm is >= 20 and <= 400) return bpm;
        return 120;
    }

    static int Whole(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var element)) return 0;
        if (element.TryGetInt32(out var whole)) return whole;
        if (element.TryGetDouble(out var number) && double.IsFinite(number)) return (int)number;
        return 0;
    }

    static bool Number(JsonElement root, string name, out double value)
    {
        value = 0;
        return root.TryGetProperty(name, out var element) && element.TryGetDouble(out value) && double.IsFinite(value);
    }

    internal     static void Reply(object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        lock (WriteLock)
        {
            Console.WriteLine(json);
            Console.Out.Flush();
        }
    }
}

record SlotRequest(string? Path, bool Bypass, int FadeBars, int FadeOutBars);

sealed class Engine
{
    public string Status { get; private set; } = "Inserts are off.";
    readonly List<LoadedInsert> _loaded = new();
    WasapiRecorder? _capture;
    FlexAsioCapture? _flex;
    WasapiPlayer? _output;
    MasterChain? _chain;
    LiveInput? _meter;
    Timer? _meterTimer;
    ListenGate? _listen;
    string? _routeInput;
    string? _routeOutput;
    string _inputName = "";
    string _outputName = "";
    int _inputChannels;
    double _tempo = 120;
    readonly OutputFilter _filter = new();
    readonly OutputDuck _duck = new();
    readonly OutputStutter _stutter = new();
    readonly OutputMotion _motion = new();
    readonly TakeRecorder _take = new();

    public object Devices(DataFlow flow)
    {
        using var enumerator = new MMDeviceEnumerator();
        return enumerator.EnumerateAudioEndPoints(flow, DeviceState.All)
            .Where(device => device.State == DeviceState.Active
                || IsCyclesName(device.FriendlyName))
            .Select(device => new { id = device.ID, name = device.FriendlyName, state = device.State.ToString(), channels = MixChannels(device) })
            .ToArray();
    }

    public object Plugins()
    {
        return Vst3PluginScanner.EnumerateInstalled()
            .Select(plugin => new { name = plugin.Name, path = plugin.Path, vendor = "" })
            .GroupBy(plugin => plugin.path, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderBy(plugin => plugin.name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public void Start(
        string? inputId,
        string? outputId,
        IReadOnlyList<SlotRequest> slots,
        double tempo,
        string? filter,
        bool hasPosition,
        float position,
        bool filterReturning,
        double filterWait,
        double filterSpan,
        int filterSlope,
        double filterQ,
        bool hasDuck,
        double duckDivision,
        double duckBpm,
        double duckBeats,
        bool duckRunning,
        bool duckSeek,
        bool duckCustom,
        int duckTrigs,
        bool hasStutter,
        double stutterDivision,
        double stutterBpm,
        double stutterBeats,
        bool stutterRunning,
        bool stutterSeek,
        bool stutterCustom,
        int stutterTrigs,
        bool motionReverse,
        bool motionTape,
        double motionBpm,
        double motionBeats,
        bool motionOver,
        double motionTapeBeats,
        bool motionTapeOver)
    {
        _tempo = tempo is >= 20 and <= 400 ? tempo : 120;
        _filter.SetShape(filterSlope, filterQ);
        if (_chain != null && _capture != null && _output != null
            && string.Equals(_routeInput, inputId, StringComparison.Ordinal)
            && string.Equals(_routeOutput, outputId, StringComparison.Ordinal))
        {
            _chain.SetTempo(_tempo);
            _chain.Hold();
            try
            {
                Adopt(slots, _capture.WaveFormat.SampleRate, true);
                _chain.SetInserts(_loaded);
            }
            finally
            {
                _chain.Release();
            }
            if (filter != null) _filter.SetMove(filter, hasPosition, position, filterReturning, filterWait, filterSpan);
            if (hasDuck) _duck.Set(duckDivision, duckBpm, duckBeats, duckRunning, duckSeek, duckCustom, duckTrigs);
            if (hasStutter) _stutter.Set(stutterDivision, stutterBpm, stutterBeats, stutterRunning, stutterSeek, stutterCustom, stutterTrigs);
            _motion.Set(motionReverse, motionTape, motionBpm, motionBeats, motionOver, motionTapeBeats, motionTapeOver);
            Status = Describe(_inputName, _outputName);
            return;
        }
        StopAudio();
        if (filter != null) _filter.SetMove(filter, hasPosition, position, filterReturning, filterWait, filterSpan);
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            var output = Find(enumerator, DataFlow.Render, outputId, "focusrite");
            var cycles = CyclesStereo(enumerator);
            LiveInput live;
            WaveFormat captureFormat;
            var found = Find(enumerator, DataFlow.Capture, inputId, "digital audio interface", "cycles", "elektron");
            var input = (string.IsNullOrWhiteSpace(inputId) || IsCycles(found) ? cycles ?? found : found)
                ?? throw new InvalidOperationException("The Model:Cycles audio input is not available. Connect it over USB, then press Refresh.");
            var tight = true;
            try
            {
                _capture = new WasapiRecorderBuilder().WithDevice(input).WithSharedMode().WithEventSync().WithLowLatency().Build();
            }
            catch
            {
                tight = false;
                _capture?.Dispose();
                _capture = new WasapiRecorderBuilder().WithDevice(input).WithSharedMode().WithEventSync().Build();
            }
            captureFormat = _capture.WaveFormat;
            if (!LiveInput.CanConvert(captureFormat))
            {
                throw new InvalidOperationException($"Can't read {captureFormat.Encoding} {captureFormat.BitsPerSample}-bit audio from {input.FriendlyName}.");
            }
            live = new LiveInput(captureFormat.SampleRate, LiveInput.StoredChannels(captureFormat.Channels), tight ? 40 : 160);
            _capture.DataAvailable += (buffer, _, _, _) => live.Add(buffer.ToArray(), buffer.Length, captureFormat);
            try
            {
                _capture.StartRecording();
            }
            catch when (tight)
            {
                tight = false;
                _capture.Dispose();
                _capture = new WasapiRecorderBuilder().WithDevice(input).WithSharedMode().WithEventSync().Build();
                captureFormat = _capture.WaveFormat;
                live = new LiveInput(captureFormat.SampleRate, LiveInput.StoredChannels(captureFormat.Channels), 160);
                _capture.DataAvailable += (buffer, _, _, _) => live.Add(buffer.ToArray(), buffer.Length, captureFormat);
                _capture.StartRecording();
            }
            Adopt(slots, captureFormat.SampleRate, false);

            int mixRate;
            using (var client = output.CreateAudioClient()) mixRate = client.MixFormat.SampleRate;
            _chain = new MasterChain(live, _loaded, mixRate, _filter, _duck, _stutter, _motion, _take);
            _chain.SetTempo(_tempo);
            _output = new WasapiPlayerBuilder().WithDevice(output).WithSharedMode().WithEventSync().WithLatency(20).Build();
            _output.Init(_chain);
            var listenId = cycles?.ID ?? input?.ID;
            _listen = listenId == null ? null : new ListenGate(output, listenId);
            if (hasDuck) _duck.Set(duckDivision, duckBpm, duckBeats, duckRunning, duckSeek, duckCustom, duckTrigs);
            if (hasStutter) _stutter.Set(stutterDivision, stutterBpm, stutterBeats, stutterRunning, stutterSeek, stutterCustom, stutterTrigs);
            _motion.Set(motionReverse, motionTape, motionBpm, motionBeats, motionOver, motionTapeBeats, motionTapeOver);
            _output.Play();
            StartMeter(live);
            _routeInput = inputId;
            _routeOutput = outputId;
            _inputName = input?.FriendlyName ?? "Model:Cycles";
            _outputName = output.FriendlyName;
            _inputChannels = live.WaveFormat.Channels;
            Thread.Sleep(450);
            Status = Describe(_inputName, _outputName);
        }
        catch (Exception error)
        {
            StopAudio();
            if (error is AudioFormatNotSupportedException
                || error.HResult == unchecked((int)0x88890008)
                || error.HResult == unchecked((int)0x8889000F)
                || error.HResult == unchecked((int)0x80070006))
            {
                throw new InvalidOperationException("The Model:Cycles audio input would not open. Turn the Model:Cycles off and on, then open the app again.");
            }
            throw;
        }
    }

    public void SetFilter(string? move, bool hasPosition, float position, bool returning, double wait, double span) =>
        _filter.SetMove(move, hasPosition, position, returning, wait, span);

    public void SetFilterShape(int slope, double q) => _filter.SetShape(slope, q);

    public void SetDuck(double division, double bpm, double beats, bool running, bool seek, bool custom, int trigs) =>
        _duck.Set(division, bpm, beats, running, seek, custom, trigs);

    public void SetStutter(double division, double bpm, double beats, bool running, bool seek, bool custom, int trigs) =>
        _stutter.Set(division, bpm, beats, running, seek, custom, trigs);

    public void SetMotion(bool reverse, bool tape, double bpm, double reverseBeats, bool over, double tapeBeats, bool tapeOver) => _motion.Set(reverse, tape, bpm, reverseBeats, over, tapeBeats, tapeOver);

    public string?[] SlotStates()
    {
        var states = new string?[_loaded.Count];
        UiThread.Invoke(() =>
        {
            for (var i = 0; i < _loaded.Count; i++)
            {
                try
                {
                    var bytes = _loaded[i].Plugin.SaveState();
                    states[i] = bytes is { Length: > 0 } ? Convert.ToBase64String(bytes) : null;
                }
                catch
                {
                    states[i] = null;
                }
            }
        });
        return states;
    }

    public void RestoreStates(string?[] states)
    {
        UiThread.Invoke(() =>
        {
            var count = Math.Min(states.Length, _loaded.Count);
            for (var i = 0; i < count; i++)
            {
                if (string.IsNullOrEmpty(states[i])) continue;
                try
                {
                    _loaded[i].Plugin.LoadState(Convert.FromBase64String(states[i]!));
                }
                catch
                {
                    /* This plug-in did not accept the stored settings. */
                }
            }
        });
    }

    public string BeginTake()
    {
        if (_chain == null) return "Play through the inserts before recording.";
        _take.Begin(_chain.WaveFormat.SampleRate);
        return "";
    }

    public double EndTake()
    {
        var seconds = _take.End();
        if (seconds <= 0) _take.Discard();
        return seconds;
    }

    public string SaveTake(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "Choose a file.";
        return _take.Save(path);
    }

    public void DiscardTake() => _take.Discard();

    void StartMeter(LiveInput live)
    {
        _meter = live;
        _meterTimer ??= new Timer(_ => PublishStems(), null, 40, 40);
    }

    void PublishStems()
    {
        var levels = _meter?.StemSnapshot();
        var wave = _meter?.WaveSnapshot();
        if (levels == null && wave == null) return;
        Program.Reply(new { kind = "stems", levels = levels ?? Array.Empty<float>(), wave });
    }

    public void StopAudio()
    {
        _chain?.Hold();
        _filter.SetLive(false);
        try { _output?.Stop(); } catch { /* already stopped */ }
        _output?.Dispose();
        _output = null;
        var flex = _flex;
        _flex = null;
        if (flex != null)
        {
            try { UiThread.Invoke(flex.Dispose); }
            catch { try { flex.Dispose(); } catch { /* already released */ } }
        }
        try { _capture?.StopRecording(); } catch { /* already stopped */ }
        _capture?.Dispose();
        _capture = null;
        _chain = null;
        _meter = null;
        _listen?.Dispose();
        _listen = null;
        _routeInput = null;
        _routeOutput = null;
        _inputChannels = 0;
        Status = "Playback through the inserts is stopped.";
    }

    public void Shutdown()
    {
        _meterTimer?.Dispose();
        _meterTimer = null;
        _take.Discard();
        StopAudio();
        try
        {
            UiThread.Invoke(() =>
            {
                PluginEditorWindow.CloseAll();
                foreach (var loaded in _loaded.ToArray()) loaded.Dispose();
                _loaded.Clear();
            });
        }
        catch { /* the window pump is already gone */ }
    }

    public void OpenEditor(string? path, string? inputId)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("Choose a plug-in first.");
        var rate = CaptureRate(inputId);
        // The audio thread must be outside the plug-in before the editor is created.
        // The plug-in itself is created on the window thread: attaching a view from a
        // different thread than the one that loaded it waits forever.
        _chain?.Hold();
        string? error = null;
        LoadedInsert? loaded = null;
        try
        {
            UiThread.Invoke(() =>
            {
                try
                {
                    loaded = _loaded.FirstOrDefault(item => string.Equals(item.Path, path, StringComparison.OrdinalIgnoreCase));
                    if (loaded == null)
                    {
                        loaded = LoadedInsert.Open(path, rate);
                        _loaded.Add(loaded);
                    }
                    if (loaded.Editor != null)
                    {
                        loaded.Editor.BringToFront();
                        return;
                    }
                    var view = loaded.Plugin.CreateView() ?? throw new InvalidOperationException("This plug-in has no window.");
                    loaded.Editor = PluginEditorWindow.Open(loaded.Name, view, () => loaded.Editor = null);
                }
                catch (Exception opened)
                {
                    error = opened.Message;
                }
            });
        }
        finally
        {
            _chain?.Release();
        }
        if (error != null) throw new InvalidOperationException(error);
        Status = $"Opened {loaded!.Name}. Raise the effect in its window, then play through the inserts.";
    }

    void Adopt(IReadOnlyList<SlotRequest> slots, int sampleRate, bool armNew)
    {
        UiThread.Invoke(() =>
        {
            var keep = new List<LoadedInsert>();
            foreach (var slot in slots.Take(6))
            {
                if (string.IsNullOrWhiteSpace(slot.Path)) continue;
                var existing = _loaded.FirstOrDefault(item =>
                    string.Equals(item.Path, slot.Path, StringComparison.OrdinalIgnoreCase) && item.Plugin.SampleRate == sampleRate);
                LoadedInsert insert;
                if (existing != null)
                {
                    _loaded.Remove(existing);
                    insert = existing;
                }
                else
                {
                    insert = LoadedInsert.Open(slot.Path, sampleRate);
                }
                insert.Bypassed = slot.Bypass;
                insert.FadeBars = slot.FadeBars;
                insert.FadeOutBars = slot.FadeOutBars;
                if (existing == null)
                {
                    insert.HeardBypass = armNew || slot.Bypass;
                    insert.Mix = insert.HeardBypass ? 0 : 1;
                }
                keep.Add(insert);
            }
            var stale = _loaded.ToArray();
            _loaded.Clear();
            _loaded.AddRange(keep);
            foreach (var item in stale)
            {
                item.Editor?.Close();
                item.Dispose();
            }
        });
    }

    string Describe(string inputName, string outputName)
    {
        var names = _loaded.Where(item => !item.Bypassed).Select(item => item.Name).ToList();
        var chainText = names.Count == 0 ? "no inserts" : string.Join(" → ", names);
        var chain = _chain;
        var inputPeak = chain?.InputPeak ?? 0;
        var difference = chain?.Difference ?? 0;
        var fault = chain?.Fault;
        if (!string.IsNullOrWhiteSpace(fault)) return fault;
        var route = _inputChannels >= 6
            ? " Six tracks are arriving on their own channels."
            : IsCyclesName(inputName)
                ? " The Model:Cycles is sending its stereo mix."
                : "";
        if (inputPeak < 0.0008f)
        {
            return $"Playing {inputName} through {outputName}: {chainText}. The Model:Cycles input is quiet right now.{route}";
        }
        if (names.Count == 0)
        {
            return $"Playing {inputName} through {outputName}. Inserts are off.{route}";
        }
        if (difference < 0.002f)
        {
            return $"Playing {inputName} through {outputName}: {chainText}. The insert is not changing the sound yet. Open it and raise the effect.{route}";
        }
        return $"Playing {inputName} through {outputName}: {chainText}.{route}";
    }

    int CaptureRate(string? inputId)
    {
        using var enumerator = new MMDeviceEnumerator();
        var input = Find(enumerator, DataFlow.Capture, inputId, "cycles", "elektron");
        using var client = input.CreateAudioClient();
        return client.MixFormat.SampleRate;
    }

    static int MixChannels(MMDevice device)
    {
        try
        {
            using var client = device.CreateAudioClient();
            return client.MixFormat.Channels;
        }
        catch
        {
            return 0;
        }
    }

    static bool IsCycles(MMDevice device) => IsCyclesHardware(device) || IsCyclesName(device.FriendlyName);

    // Endpoint properties that name the USB function behind it, e.g.
    // "{1}.USB\VID_1935&PID_001B&MI_00\..." and the KS topology path "\\?\usb#vid_1935&pid_001b&mi_00#...".
    static readonly PropertyKey EndpointDeviceInstance = new(new Guid("b3f8fa53-0004-438e-9003-51a46e139bfc"), 2);
    static readonly PropertyKey EndpointTopologyPath = new(new Guid("233164c8-1b2c-4c7d-bc68-b671687a2567"), 1);

    /// <summary>True when the endpoint is backed by Elektron USB hardware (VID_1935), whatever Windows named it.</summary>
    static bool IsCyclesHardware(MMDevice device)
    {
        try
        {
            var store = device.Properties;
            foreach (var key in new[] { EndpointDeviceInstance, EndpointTopologyPath })
            {
                if (!store.Contains(key)) continue;
                if (store[key].Value is string text && text.Contains("VID_1935", StringComparison.OrdinalIgnoreCase)) return true;
            }
        }
        catch
        {
            // a device that cannot be read is not chosen on hardware grounds
        }
        return false;
    }

    static bool OpensShared(MMDevice device)
    {
        try
        {
            using var client = device.CreateAudioClient();
            client.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.None, 2_000_000, 0, client.MixFormat, Guid.Empty);
            return true;
        }
        catch
        {
            return false;
        }
    }

    static bool IsCyclesName(string name) =>
        name.Contains("Cycles", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Elektron", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Digital Audio Interface", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Picks the Model:Cycles stereo recording endpoint. Stock firmware in USB MODE A+M
    /// offers one stereo capture pin. The endpoint backed by the Model:Cycles USB audio
    /// function (VID_1935) wins over a name match, a 2-channel mix format wins over a
    /// wider one, and an endpoint whose shared Initialize succeeds wins over one that fails.
    /// The widest device is no longer preferred.
    /// </summary>
    static MMDevice? CyclesStereo(MMDeviceEnumerator enumerator)
    {
        MMDevice? best = null;
        var bestScore = -1;
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            var hardware = IsCyclesHardware(device);
            if (!hardware && !IsCyclesName(device.FriendlyName)) continue;
            var score = (hardware ? 4 : 0) + (MixChannels(device) == 2 ? 2 : 0) + (OpensShared(device) ? 1 : 0);
            if (score <= bestScore) continue;
            best = device;
            bestScore = score;
        }
        return best;
    }

    static MMDevice Find(MMDeviceEnumerator enumerator, DataFlow flow, string? id, params string[] preferred)
    {
        var devices = enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active).ToList();
        if (!string.IsNullOrWhiteSpace(id))
        {
            var chosen = devices.FirstOrDefault(device => device.ID == id);
            if (chosen != null) return chosen;
            var named = enumerator.EnumerateAudioEndPoints(flow, DeviceState.All).FirstOrDefault(device => device.ID == id);
            var label = named?.FriendlyName ?? "That device";
            throw new InvalidOperationException($"{label} is not available right now. Turn the Model:Cycles on, then press Refresh.");
        }
        foreach (var hint in preferred)
        {
            var match = devices.FirstOrDefault(device => device.FriendlyName.Contains(hint, StringComparison.OrdinalIgnoreCase));
            if (match != null) return match;
        }
        if (flow == DataFlow.Render) return enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        var cycles = enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.All).Any(device => IsCyclesName(device.FriendlyName));
        throw new InvalidOperationException(cycles
            ? "The Model:Cycles is plugged in, but Windows is not offering its audio input. Turn it on, then press Refresh."
            : "The Model:Cycles audio input is not available. Connect it over USB, then press Refresh.");
    }
}

sealed class LoadedInsert : IDisposable
{
    public string Name { get; }
    public string Path { get; }
    public Vst3Plugin Plugin { get; }
    public PluginEditorWindow? Editor { get; set; }
    public bool Bypassed { get; set; }
    public int FadeBars;
    public int FadeOutBars;
    public bool HeardBypass;
    public bool FadingOut;
    public float Mix = 1;
    public float FadeFrom = 1;
    public int FadePos;
    public int FadeLength;
    readonly Vst3Module _module;

    LoadedInsert(string name, string path, Vst3Module module, Vst3Plugin plugin)
    {
        Name = name;
        Path = path;
        _module = module;
        Plugin = plugin;
    }

    public static LoadedInsert Open(string path, int sampleRate)
    {
        var module = Vst3Module.Load(path);
        var audioClass = module.GetClasses().FirstOrDefault(candidate => candidate.IsEffect)
            ?? module.GetClasses().FirstOrDefault(candidate => candidate.IsAudioModule);
        if (audioClass == null)
        {
            module.Dispose();
            throw new InvalidOperationException($"No audio processor in {System.IO.Path.GetFileName(path)}.");
        }
        var plugin = module.CreatePlugin(audioClass, sampleRate, 512);
        if (plugin.InputChannelCount is < 1 or > 2 || plugin.OutputChannelCount is < 1 or > 2)
        {
            plugin.Dispose();
            module.Dispose();
            throw new InvalidOperationException($"{audioClass.Name} is not a stereo or mono master insert.");
        }
        var bypass = plugin.Parameters.BypassParameter;
        if (bypass is { IsReadOnly: false }) bypass.NormalizedValue = 0;
        return new LoadedInsert(audioClass.Name, path, module, plugin);
    }

    public void Dispose()
    {
        Plugin.Dispose();
        _module.Dispose();
    }
}

/// <summary>
/// Live master bus. A short read is silence for that block, never the end of the recording,
/// because a VST3 effect treats end-of-stream as "stop processing."
/// </summary>
sealed class MasterChain : IWaveProvider
{
    const int Block = 512;
    readonly LiveInput _input;
    volatile LoadedInsert[] _inserts;
    readonly int _inputRate;
    readonly float[] _dry;
    readonly float[] _pluginIn;
    readonly float[] _pluginOut;
    readonly float[] _left;
    readonly float[] _right;
    readonly float[] _lead;
    int _stutterEpoch;
    readonly float[] _ring;
    readonly OutputFilter _filter;
    readonly OutputDuck _duck;
    readonly OutputStutter _stutter;
    readonly OutputMotion _motion;
    readonly TakeRecorder _take;
    int _ringRead;
    int _ringCount;
    int _busy;
    double _fraction;
    volatile bool _hold;
    double _bpm = 120;

    public float InputPeak { get; private set; }
    public float Difference { get; private set; }
    public string? Fault { get; private set; }

    public void Hold()
    {
        _hold = true;
        var started = Environment.TickCount64;
        while (Volatile.Read(ref _busy) > 0 && Environment.TickCount64 - started < 1000) Thread.Sleep(1);
    }

    public void Release() => _hold = false;

    public MasterChain(LiveInput input, IReadOnlyList<LoadedInsert> inserts, int outputRate, OutputFilter filter, OutputDuck duck, OutputStutter stutter, OutputMotion motion, TakeRecorder take)
    {
        _input = input;
        _inserts = inserts.ToArray();
        _inputRate = input.WaveFormat.SampleRate;
        _filter = filter;
        _duck = duck;
        _stutter = stutter;
        _motion = motion;
        _take = take;
        WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(outputRate, 2);
        _dry = new float[Block * 2];
        _pluginIn = new float[Block * 2];
        _pluginOut = new float[Block * 2];
        _left = new float[Block * 2];
        _right = new float[Block * 2];
        _lead = new float[Block * 2];
        _ring = new float[_inputRate * 2];
    }

    public WaveFormat WaveFormat { get; }

    public void SetInserts(IReadOnlyList<LoadedInsert> inserts) => _inserts = inserts.ToArray();

    public void SetTempo(double bpm) => _bpm = bpm is >= 20 and <= 400 ? bpm : 120;

    public int Read(Span<byte> buffer)
    {
        buffer.Clear();
        if (_hold) return buffer.Length;
        Interlocked.Increment(ref _busy);
        try
        {
            if (_hold) return buffer.Length;
            var frames = buffer.Length / 8;
            if (frames == 0) return buffer.Length;
            var interleaved = MemoryMarshal.Cast<byte, float>(buffer)[..(frames * 2)];
            if (WaveFormat.SampleRate == _inputRate) Render(interleaved, frames);
            else Resample(interleaved, frames);
            _take.Append(interleaved);
            return buffer.Length;
        }
        finally
        {
            Interlocked.Decrement(ref _busy);
        }
    }

    void Render(Span<float> destination, int frames)
    {
        var done = 0;
        while (done < frames)
        {
            var block = Math.Min(Block, frames - done);
            _input.ReadStereo(_dry.AsSpan(0, block * 2));
            Process(_dry, block, destination.Slice(done * 2, block * 2));
            done += block;
        }
    }

    void Resample(Span<float> destination, int frames)
    {
        var step = (double)_inputRate / WaveFormat.SampleRate;
        for (var frame = 0; frame < frames; frame++)
        {
            while (_ringCount < 2) PullRing(Block);
            var next = (_ringRead + 2) % _ring.Length;
            var mix = (float)_fraction;
            destination[frame * 2] = _ring[_ringRead] + (_ring[next] - _ring[_ringRead]) * mix;
            destination[frame * 2 + 1] = _ring[_ringRead + 1] + (_ring[next + 1] - _ring[_ringRead + 1]) * mix;
            _fraction += step;
            var advance = Math.Min((int)_fraction, _ringCount - 1);
            if (advance > 0)
            {
                _ringRead = (_ringRead + advance * 2) % _ring.Length;
                _ringCount -= advance;
                _fraction -= advance;
            }
        }
    }

    void PullRing(int frames)
    {
        _input.ReadStereo(_dry.AsSpan(0, frames * 2));
        Process(_dry, frames, _left.AsSpan(0, frames * 2));
        for (var frame = 0; frame < frames; frame++)
        {
            if (_ringCount >= _ring.Length / 2)
            {
                _ringRead = (_ringRead + 2) % _ring.Length;
                _ringCount--;
            }
            var write = (_ringRead + _ringCount * 2) % _ring.Length;
            _ring[write] = _left[frame * 2];
            _ring[write + 1] = _left[frame * 2 + 1];
            _ringCount++;
        }
    }

    void Process(float[] input, int frames, Span<float> output)
    {
        var lead = _motion.Lead(input, _lead, frames, _inputRate);
        var inserts = _inserts;
        var current = lead != 0 ? _lead : input;
        var channels = 2;
        var onLeft = true;
        foreach (var insert in inserts)
        {
            var wantWet = !insert.Bypassed;
            if (!wantWet && (insert.HeardBypass || insert.FadeOutBars <= 0))
            {
                insert.HeardBypass = true;
                insert.FadingOut = false;
                insert.FadePos = 0;
                insert.FadeLength = 0;
                insert.Mix = 0;
                continue;
            }
            if (wantWet && (insert.HeardBypass || insert.FadingOut))
            {
                insert.HeardBypass = false;
                insert.FadingOut = false;
                insert.FadeFrom = insert.Mix;
                insert.FadePos = 0;
                insert.FadeLength = BarsToFrames(insert.FadeBars);
            }
            else if (!wantWet && !insert.FadingOut)
            {
                insert.FadingOut = true;
                insert.FadeFrom = insert.Mix <= 0 ? 1 : insert.Mix;
                insert.FadePos = 0;
                insert.FadeLength = BarsToFrames(insert.FadeOutBars);
                if (insert.FadeLength <= 0)
                {
                    insert.HeardBypass = true;
                    insert.FadingOut = false;
                    insert.Mix = 0;
                    continue;
                }
            }
            var plugin = insert.Plugin;
            var into = onLeft ? _left : _right;
            try
            {
                CopyChannels(current, channels, plugin.InputChannelCount, frames, _pluginIn);
                plugin.Process(_pluginIn.AsSpan(0, frames * plugin.InputChannelCount), _pluginOut.AsSpan(0, frames * plugin.OutputChannelCount), frames);
                CopyChannels(_pluginOut, plugin.OutputChannelCount, 2, frames, into);
                var length = insert.FadeLength;
                var pos = insert.FadePos;
                if (length > 0 && pos < length)
                {
                    var next = Math.Min(length, pos + frames);
                    Blend(current, into, frames, WetAt(insert, pos), WetAt(insert, next));
                    insert.FadePos = next;
                    insert.Mix = WetAt(insert, next);
                    if (next >= length)
                    {
                        insert.FadeLength = 0;
                        insert.FadePos = 0;
                        if (insert.FadingOut)
                        {
                            insert.FadingOut = false;
                            insert.HeardBypass = true;
                            insert.Mix = 0;
                        }
                        else insert.Mix = 1;
                    }
                }
                else insert.Mix = insert.FadingOut ? 0 : 1;
                current = into;
                channels = 2;
                onLeft = !onLeft;
            }
            catch (Exception error)
            {
                Fault = error.Message;
            }
        }
        Note(input.AsSpan(0, frames * 2), current.AsSpan(0, frames * channels));
        var source = current.AsSpan(0, frames * 2);
        if (!source.Overlaps(output)) source.CopyTo(output);
        if (lead > 0 && lead != _stutterEpoch)
        {
            _stutter.Renew();
            _stutterEpoch = lead;
        }
        else if (lead <= 0 && _stutterEpoch != 0)
        {
            _stutter.Renew();
            _stutterEpoch = 0;
        }
        var filterAfterReverse = lead == 0 && _motion.PlaysReverse;
        if (!filterAfterReverse) _filter.Process(output, frames, _inputRate);
        _stutter.Process(output, frames, _inputRate);
        if (lead == 0) _motion.Process(output, frames, _inputRate);
        if (filterAfterReverse) _filter.Process(output, frames, _inputRate);
        _duck.Process(output, frames, _inputRate);
        if (_motion.HoldsSilence) output.Clear();
    }

    void Note(ReadOnlySpan<float> dry, ReadOnlySpan<float> wet)
    {
        float inputPeak = 0;
        float difference = 0;
        var count = Math.Min(dry.Length, wet.Length);
        for (var i = 0; i < count; i++)
        {
            inputPeak = Math.Max(inputPeak, Math.Abs(dry[i]));
            difference = Math.Max(difference, Math.Abs(wet[i] - dry[i]));
        }
        InputPeak = Math.Max(inputPeak, InputPeak * 0.92f);
        Difference = Math.Max(difference, Difference * 0.92f);
    }

    int BarsToFrames(int bars)
    {
        if (bars <= 0) return 0;
        var bpm = _bpm < 1 ? 120 : _bpm;
        var frames = bars * 4.0 * 60.0 / bpm * _inputRate;
        if (frames < 1) return 0;
        return (int)Math.Round(Math.Min(frames, _inputRate * 60.0));
    }

    static float WetAt(LoadedInsert insert, int samplePos)
    {
        if (insert.FadeLength <= 0) return insert.FadingOut ? 0 : 1;
        var t = Math.Clamp(samplePos / (float)insert.FadeLength, 0, 1);
        var target = insert.FadingOut ? 0f : 1f;
        return insert.FadeFrom + (target - insert.FadeFrom) * t;
    }

    static void Blend(float[] dry, float[] wet, int frames, float mix0, float mix1)
    {
        for (var frame = 0; frame < frames; frame++)
        {
            var mix = frames <= 1 ? mix1 : mix0 + (mix1 - mix0) * frame / (frames - 1);
            var keep = 1f - mix;
            var left = frame * 2;
            var right = left + 1;
            wet[left] = dry[left] * keep + wet[left] * mix;
            wet[right] = dry[right] * keep + wet[right] * mix;
        }
    }

    static void CopyChannels(float[] source, int from, int to, int frames, float[] destination)
    {
        if (from == to)
        {
            source.AsSpan(0, frames * from).CopyTo(destination);
            return;
        }
        if (from == 1 && to == 2)
        {
            for (var frame = 0; frame < frames; frame++)
            {
                destination[frame * 2] = source[frame];
                destination[frame * 2 + 1] = source[frame];
            }
            return;
        }
        for (var frame = 0; frame < frames; frame++)
            destination[frame] = (source[frame * 2] + source[frame * 2 + 1]) * 0.5f;
    }
}

sealed class LiveInput : ISampleProvider
{
    readonly float[] _ring;
    readonly object _gate = new();
    readonly object _stemGate = new();
    readonly float[] _stem = new float[6];
    readonly float[] _mix = new float[1920];
    int _mixAt;
    int _mixCount;
    readonly int _limit;
    float[] _scratch = Array.Empty<float>();
    int _read;
    int _write;
    int _count;

    public static int StoredChannels(int deviceChannels) => deviceChannels > 0 ? 2 : 2;

    /// <summary>Leaves a single track untouched. A stack of tracks eases off above full scale.</summary>
    static float SpeakerSample(float sample)
    {
        const float knee = 0.9f;
        var abs = MathF.Abs(sample);
        if (abs <= knee) return sample;
        var over = (abs - knee) / (1f - knee);
        var shaped = knee + (1f - knee) * (over / (1f + over));
        return MathF.CopySign(MathF.Min(shaped, 0.999f), sample);
    }

    public LiveInput(int sampleRate, int channels, int maxDelayMs)
    {
        WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, channels);
        _ring = new float[sampleRate * channels];
        _limit = Math.Max(channels * 2, sampleRate * channels * Math.Clamp(maxDelayMs, 20, 250) / 1000);
    }

    public WaveFormat WaveFormat { get; }

    public static bool CanConvert(WaveFormat format)
    {
        var readable = Readable(format);
        return readable.Encoding == WaveFormatEncoding.IeeeFloat && readable.BitsPerSample == 32
            || readable.Encoding == WaveFormatEncoding.Pcm && readable.BitsPerSample is 16 or 24 or 32;
    }

    public static WaveFormat Readable(WaveFormat format)
    {
        if (format is WaveFormatExtensible extensible)
        {
            var standard = extensible.ToStandardWaveFormat();
            if (standard.Encoding is WaveFormatEncoding.IeeeFloat or WaveFormatEncoding.Pcm) return standard;
        }
        return format;
    }

    public void AddInterleaved(float[] samples, int channels)
    {
        if (samples.Length == 0 || channels < 1) return;
        NoteStems(samples, channels);
        if (channels == WaveFormat.Channels) Write(samples);
    }

    public void Add(byte[] buffer, int bytes, WaveFormat format)
    {
        format = Readable(format);
        var samples = BytesToFloat(buffer, bytes, format);
        if (samples.Length == 0) return;
        NoteStems(samples, format.Channels);
        if (format.Channels == WaveFormat.Channels)
        {
            Write(samples);
            return;
        }
        if (format.Channels == 1 && WaveFormat.Channels == 2)
        {
            var stereo = new float[samples.Length * 2];
            for (var i = 0; i < samples.Length; i++)
            {
                stereo[i * 2] = samples[i];
                stereo[i * 2 + 1] = samples[i];
            }
            Write(stereo);
            return;
        }
        if (format.Channels >= WaveFormat.Channels && WaveFormat.Channels > 2)
        {
            var keep = WaveFormat.Channels;
            var frames = samples.Length / format.Channels;
            var stems = new float[frames * keep];
            for (var frame = 0; frame < frames; frame++)
            {
                var from = frame * format.Channels;
                var to = frame * keep;
                for (var channel = 0; channel < keep; channel++) stems[to + channel] = samples[from + channel];
            }
            Write(stems);
            return;
        }
        if (format.Channels > 2 && WaveFormat.Channels == 2)
        {
            var frames = samples.Length / format.Channels;
            var stereo = new float[frames * 2];
            for (var frame = 0; frame < frames; frame++)
            {
                float sum = 0;
                var at = frame * format.Channels;
                for (var channel = 0; channel < format.Channels; channel++) sum += samples[at + channel];
                var mixed = SpeakerSample(sum);
                stereo[frame * 2] = mixed;
                stereo[frame * 2 + 1] = mixed;
            }
            Write(stereo);
        }
    }

    /// <summary>
    /// Speakers stay stereo. Six mono stems sum at full level onto both sides.
    /// Sixteen channels are the track pairs plus the delay and reverb returns.
    /// </summary>
    public void ReadStereo(Span<float> stereo)
    {
        var channels = Math.Max(1, WaveFormat.Channels);
        if (channels <= 2)
        {
            Read(stereo);
            return;
        }
        var frames = stereo.Length / 2;
        var need = frames * channels;
        if (_scratch.Length < need) _scratch = new float[need];
        Read(_scratch.AsSpan(0, need));
        for (var frame = 0; frame < frames; frame++)
        {
            var at = frame * channels;
            float left;
            float right;
            if (channels >= 16)
            {
                left = 0;
                right = 0;
                for (var track = 0; track < 6; track++)
                {
                    left += _scratch[at + track * 2];
                    right += _scratch[at + track * 2 + 1];
                }
                left += _scratch[at + 12] + _scratch[at + 14];
                right += _scratch[at + 13] + _scratch[at + 15];
            }
            else
            {
                float sum = 0;
                var stems = Math.Min(6, channels);
                for (var channel = 0; channel < stems; channel++) sum += _scratch[at + channel];
                left = sum;
                right = sum;
            }
            stereo[frame * 2] = SpeakerSample(left);
            stereo[frame * 2 + 1] = SpeakerSample(right);
        }
    }

    public int[] WaveSnapshot()
    {
        const int points = 1024;
        var result = new int[points];
        lock (_stemGate)
        {
            var filled = _mixCount;
            if (filled < 32)
            {
                for (var i = 0; i < points; i++) result[i] = 128;
                return result;
            }
            var take = Math.Min(filled, points);
            var start = (_mixAt - take + _mix.Length) % _mix.Length;
            var offset = points - take;
            for (var i = 0; i < offset; i++) result[i] = 128;
            for (var i = 0; i < take; i++)
            {
                var sample = Math.Clamp(_mix[(start + i) % _mix.Length], -1f, 1f);
                result[offset + i] = (int)Math.Round(128 + sample * 127);
            }
        }
        return result;
    }

    public float[]? StemSnapshot()
    {
        if (WaveFormat.Channels < 6) return null;
        var copy = new float[6];
        lock (_stemGate)
        {
            for (var channel = 0; channel < 6; channel++)
            {
                copy[channel] = _stem[channel];
                _stem[channel] *= 0.65f;
            }
        }
        return copy;
    }

    void NoteStems(float[] samples, int channels)
    {
        if (channels < 1) return;
        var frames = samples.Length / channels;
        var wide = channels >= 16;
        var stems = wide ? 6 : Math.Min(6, channels);
        Span<float> peak = stackalloc float[6];
        lock (_stemGate)
        {
            for (var frame = 0; frame < frames; frame++)
            {
                var at = frame * channels;
                float sum;
                if (wide)
                {
                    float left = 0;
                    float right = 0;
                    for (var track = 0; track < 6; track++)
                    {
                        var leftSample = samples[at + track * 2];
                        var rightSample = samples[at + track * 2 + 1];
                        var level = MathF.Max(MathF.Abs(leftSample), MathF.Abs(rightSample));
                        if (level > peak[track]) peak[track] = level;
                        left += leftSample;
                        right += rightSample;
                    }
                    left += samples[at + 12] + samples[at + 14];
                    right += samples[at + 13] + samples[at + 15];
                    sum = SpeakerSample((left + right) * 0.5f);
                }
                else if (stems <= 2)
                {
                    sum = channels > 1 ? (samples[at] + samples[at + 1]) * 0.5f : samples[at];
                }
                else
                {
                    float mixed = 0;
                    for (var channel = 0; channel < channels; channel++)
                    {
                        var level = Math.Abs(samples[at + channel]);
                        if (channel < 6 && level > peak[channel]) peak[channel] = level;
                        mixed += samples[at + channel];
                    }
                    sum = SpeakerSample(mixed);
                }
                _mix[_mixAt] = sum;
                _mixAt = (_mixAt + 1) % _mix.Length;
                if (_mixCount < _mix.Length) _mixCount++;
            }
            if (stems >= 6)
            {
                for (var channel = 0; channel < 6; channel++)
                    _stem[channel] = Math.Max(_stem[channel], peak[channel]);
            }
        }
    }

    public int Read(Span<float> buffer)
    {
        lock (_gate)
        {
            var channels = Math.Max(1, WaveFormat.Channels);
            var limit = _limit;
            if (_count > limit)
            {
                var drop = _count - limit;
                drop -= drop % channels;
                if (drop > 0)
                {
                    _read = (_read + drop) % _ring.Length;
                    _count -= drop;
                }
            }
            for (var i = 0; i < buffer.Length; i++)
            {
                if (_count == 0)
                {
                    buffer[i] = 0;
                    continue;
                }
                buffer[i] = _ring[_read];
                _read = (_read + 1) % _ring.Length;
                _count--;
            }
        }
        return buffer.Length;
    }

    void Write(float[] samples)
    {
        lock (_gate)
        {
            foreach (var sample in samples)
            {
                _ring[_write] = sample;
                _write = (_write + 1) % _ring.Length;
                if (_count < _ring.Length) _count++;
                else _read = (_read + 1) % _ring.Length;
            }
        }
    }

    static float[] BytesToFloat(byte[] buffer, int bytes, WaveFormat format)
    {
        if (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
        {
            var count = bytes / 4;
            var samples = new float[count];
            Buffer.BlockCopy(buffer, 0, samples, 0, count * 4);
            return samples;
        }
        if (format.Encoding == WaveFormatEncoding.Pcm && format.BitsPerSample == 16)
        {
            var count = bytes / 2;
            var samples = new float[count];
            for (var i = 0; i < count; i++) samples[i] = BitConverter.ToInt16(buffer, i * 2) / 32768f;
            return samples;
        }
        if (format.Encoding == WaveFormatEncoding.Pcm && format.BitsPerSample == 24)
        {
            var count = bytes / 3;
            var samples = new float[count];
            for (var i = 0; i < count; i++)
            {
                var value = buffer[i * 3] | (buffer[i * 3 + 1] << 8) | (buffer[i * 3 + 2] << 16);
                if ((value & 0x800000) != 0) value |= unchecked((int)0xff000000);
                samples[i] = value / 8388608f;
            }
            return samples;
        }
        if (format.Encoding == WaveFormatEncoding.Pcm && format.BitsPerSample == 32)
        {
            var count = bytes / 4;
            var samples = new float[count];
            for (var i = 0; i < count; i++) samples[i] = BitConverter.ToInt32(buffer, i * 4) / 2147483648f;
            return samples;
        }
        return Array.Empty<float>();
    }
}

/// <summary>
/// Windows "listen to this device" already plays the Model:Cycles into the speakers.
/// Mute that stream while this host is the one playing, then put it back.
/// </summary>
sealed class ListenGate : IDisposable
{
    readonly MMDevice _render;
    readonly string _marker;
    readonly List<Held> _held = new();
    readonly object _gate = new();
    readonly Timer _timer;
    bool _closed;

    public ListenGate(MMDevice render, string captureEndpointId)
    {
        _render = render;
        _marker = Marker(captureEndpointId);
        Silence();
        _timer = new Timer(_ => Silence(), null, 400, 400);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_closed) return;
            _closed = true;
            _timer.Dispose();
            foreach (var held in _held)
            {
                try { held.Session.SimpleAudioVolume.Mute = held.WasMuted; }
                catch { /* the listen stream has already gone */ }
            }
            _held.Clear();
        }
    }

    void Silence()
    {
        lock (_gate)
        {
            if (_closed || _marker.Length == 0) return;
            SessionCollection sessions;
            try { sessions = _render.AudioSessionManager.Sessions; }
            catch { return; }
            for (var i = 0; i < sessions.Count; i++)
            {
                AudioSessionControl session;
                try { session = sessions[i]; }
                catch { continue; }
                string id;
                try { id = session.GetSessionIdentifier ?? ""; }
                catch { continue; }
                if (id.IndexOf(_marker, StringComparison.OrdinalIgnoreCase) < 0) continue;
                try
                {
                    if (session.GetProcessID == (uint)Environment.ProcessId) continue;
                }
                catch { /* a session without a process can still be the listen stream */ }
                if (_held.Exists(item => item.Id == id))
                {
                    try
                    {
                        if (!session.SimpleAudioVolume.Mute) session.SimpleAudioVolume.Mute = true;
                    }
                    catch { /* it will be tried again */ }
                    continue;
                }
                try
                {
                    var volume = session.SimpleAudioVolume;
                    var wasMuted = volume.Mute;
                    volume.Mute = true;
                    _held.Add(new Held(id, session, wasMuted));
                }
                catch { /* this session cannot be muted */ }
            }
        }
    }

    static string Marker(string endpointId)
    {
        var start = endpointId.LastIndexOf('{');
        var end = endpointId.LastIndexOf('}');
        if (start >= 0 && end > start) return endpointId.Substring(start + 1, end - start - 1);
        return "";
    }

    sealed record Held(string Id, AudioSessionControl Session, bool WasMuted);
}
