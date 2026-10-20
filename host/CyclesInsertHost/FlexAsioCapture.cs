using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace CyclesInsertHost;

/// <summary>
/// Captures the Model:Cycles through FlexASIO. Shared WASAPI is tried first, then MME,
/// then DirectSound. The driver is asked for 6 channels at 48 kHz, and its output side
/// stays closed so playback can remain on the Focusrite.
/// </summary>
sealed class FlexAsioCapture : IDisposable
{
    const int SampleRate = 48000;
    const int StemChannels = 6;
    static readonly Guid DriverId = new("462F2ABF-5278-436A-95B6-72CBF65482AE");

    readonly float[] _interleaved;
    AsioDriver? _driver;
    IntPtr _buffers;
    IntPtr _callbackMemory;
    BufferInfo[] _infos = Array.Empty<BufferInfo>();
    BufferSwitch? _switch;
    SampleRateChanged? _rateChanged;
    AsioMessage? _message;
    BufferSwitchTime? _switchTime;
    int _sampleType;
    bool _started;
    bool _created;
    Action<float[]>? _audio;

    FlexAsioCapture(int channels, int frames)
    {
        ChannelCount = channels;
        Frames = frames;
        _interleaved = new float[frames * channels];
    }

    public int ChannelCount { get; }
    public int Frames { get; }
    public int Rate => SampleRate;

    public static bool IsInstalled =>
        Registry.LocalMachine.OpenSubKey(@"SOFTWARE\ASIO\FlexASIO") != null;

    public static FlexAsioCapture OpenCycles()
    {
        var attempts = new (string Backend, string Pattern)[]
        {
            ("Windows WASAPI", @"Digital Audio Interface \(.*Elektron Model:Cycles\)"),
            ("MME", "Digital Audio Interface"),
            ("Windows DirectSound", @"Digital Audio Interface \(.*Elektron Model:Cycles\)")
        };
        var errors = new List<string>();
        foreach (var attempt in attempts)
        {
            FlexAsioCapture? capture = null;
            try
            {
                capture = Open(attempt.Backend, attempt.Pattern, StemChannels);
                if (capture.ChannelCount < StemChannels)
                    throw new InvalidOperationException($"opened {capture.ChannelCount} channels");
                return capture;
            }
            catch (Exception error)
            {
                errors.Add($"{attempt.Backend}: {error.Message}");
                capture?.Dispose();
            }
        }
        throw new InvalidOperationException(
            "FlexASIO did not open the Model:Cycles at 6 channels and 48 kHz. " + string.Join(" ", errors));
    }

    public static FlexAsioCapture Open(string backend, string devicePattern, int channels)
    {
        WriteConfig(backend, devicePattern, channels);
        var driver = AsioDriver.Open(DriverId);
        FlexAsioCapture? capture = null;
        try
        {
            if (!driver.Init(IntPtr.Zero))
                throw new InvalidOperationException(Blank(driver.Error(), "FlexASIO would not start."));
            if (!driver.CanSampleRate(SampleRate) || !driver.SetSampleRate(SampleRate))
                throw new InvalidOperationException($"FlexASIO will not run at {SampleRate} Hz. {driver.Error()}");
            driver.GetChannels(out var inputs, out _);
            if (inputs < channels)
                throw new InvalidOperationException($"FlexASIO is offering {inputs} input channels.");
            driver.GetBufferSize(out var min, out var max, out var preferred, out _);
            var frames = preferred >= min && preferred <= max ? preferred : Math.Clamp(480, min, Math.Max(min, max));
            capture = new FlexAsioCapture(channels, frames)
            {
                _driver = driver,
                _sampleType = driver.ChannelInfo(0, true)
            };
            capture.Create(channels, frames);
            return capture;
        }
        catch
        {
            if (capture == null) driver.Dispose();
            else capture.Dispose();
            throw;
        }
    }

    public void Start(Action<float[]> audio)
    {
        _audio = audio;
        _driver?.Start();
        _started = true;
    }

    public void Dispose()
    {
        var driver = _driver;
        _driver = null;
        if (driver == null) return;
        try { if (_started) driver.Stop(); } catch { /* already stopped */ }
        try { if (_created) driver.DisposeBuffers(); } catch { /* already released */ }
        driver.Dispose();
        if (_buffers != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(_buffers);
            _buffers = IntPtr.Zero;
        }
        if (_callbackMemory != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(_callbackMemory);
            _callbackMemory = IntPtr.Zero;
        }
    }

    void Create(int channels, int frames)
    {
        _switch = OnSwitch;
        _rateChanged = _ => { };
        _message = OnMessage;
        _switchTime = (time, index, _) =>
        {
            OnSwitch(index, 1);
            return time;
        };
        var callbacks = new AsioCallbacks
        {
            BufferSwitch = _switch,
            SampleRateDidChange = _rateChanged,
            AsioMessage = _message,
            BufferSwitchTimeInfo = _switchTime
        };
        var size = Marshal.SizeOf<BufferInfo>();
        _buffers = Marshal.AllocHGlobal(size * channels);
        for (var channel = 0; channel < channels; channel++)
        {
            Marshal.StructureToPtr(new BufferInfo { IsInput = 1, Channel = channel }, _buffers + size * channel, false);
        }
        _callbackMemory = Marshal.AllocHGlobal(Marshal.SizeOf<AsioCallbacks>());
        Marshal.StructureToPtr(callbacks, _callbackMemory, false);
        _driver!.CreateBuffers(_buffers, channels, frames, _callbackMemory);
        _created = true;
        _infos = new BufferInfo[channels];
        for (var channel = 0; channel < channels; channel++)
            _infos[channel] = Marshal.PtrToStructure<BufferInfo>(_buffers + size * channel);
    }

    void OnSwitch(int index, int _)
    {
        try
        {
            var channels = ChannelCount;
            var frames = Frames;
            for (var channel = 0; channel < channels; channel++)
            {
                var source = index == 0 ? _infos[channel].Buffer0 : _infos[channel].Buffer1;
                for (var frame = 0; frame < frames; frame++)
                    _interleaved[frame * channels + channel] = Sample(source, frame);
            }
            _audio?.Invoke(_interleaved);
        }
        catch
        {
            /* The driver thread must not see a managed exception. */
        }
    }

    float Sample(IntPtr source, int frame)
    {
        if (source == IntPtr.Zero) return 0;
        return _sampleType switch
        {
            19 => BitConverter.Int32BitsToSingle(Marshal.ReadInt32(source, frame * 4)),
            18 or 27 => Marshal.ReadInt32(source, frame * 4) / 2147483648f,
            16 => Marshal.ReadInt16(source, frame * 2) / 32768f,
            _ => BitConverter.Int32BitsToSingle(Marshal.ReadInt32(source, frame * 4))
        };
    }

    static int OnMessage(int selector, int value, IntPtr _, IntPtr __)
    {
        if (selector == 2) return 2;
        if (selector == 1) return value is 2 or 7 ? 1 : 0;
        return 0;
    }

    static void WriteConfig(string backend, string devicePattern, int channels)
    {
        var exclusive = backend == "Windows WASAPI" ? "\nwasapiExclusiveMode = false\n" : "\n";
        var text = $$"""
            backend = "{{backend}}"
            bufferSizeSamples = 480

            [input]
            deviceRegex = '{{devicePattern}}'
            channels = {{channels}}
            sampleType = "Float32"{{exclusive}}
            [output]
            device = ""
            """;
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "FlexASIO.toml");
        File.WriteAllText(path, text.ReplaceLineEndings("\n"));
    }

    static string Blank(string value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value;

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct BufferInfo
    {
        public int IsInput;
        public int Channel;
        public IntPtr Buffer0;
        public IntPtr Buffer1;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct AsioCallbacks
    {
        public BufferSwitch BufferSwitch;
        public SampleRateChanged SampleRateDidChange;
        public AsioMessage AsioMessage;
        public BufferSwitchTime BufferSwitchTimeInfo;
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate void BufferSwitch(int index, int direct);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate void SampleRateChanged(double rate);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate int AsioMessage(int selector, int value, IntPtr message, IntPtr opt);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    delegate IntPtr BufferSwitchTime(IntPtr time, int index, int direct);
}

/// <summary>The part of the ASIO COM driver this host calls.</summary>
sealed class AsioDriver : IDisposable
{
    IntPtr _com;
    AsioInit? _init;
    AsioGetText? _error;
    AsioStartStop? _start;
    AsioStartStop? _stop;
    AsioGetChannels? _channels;
    AsioGetBufferSize? _bufferSize;
    AsioSampleRateQuery? _canRate;
    AsioSetSampleRate? _setRate;
    AsioChannelInfoQuery? _channelInfo;
    AsioCreateBuffers? _create;

    public static AsioDriver Open(Guid id)
    {
        var driver = new AsioDriver();
        var clsid = id;
        var iid = id;
        var hr = CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iid, out driver._com);
        if (hr != 0 || driver._com == IntPtr.Zero)
            throw new InvalidOperationException($"FlexASIO is installed, but it would not load (0x{hr:X8}).");
        var table = Marshal.ReadIntPtr(driver._com);
        driver._init = Slot<AsioInit>(table, 3);
        driver._error = Slot<AsioGetText>(table, 6);
        driver._start = Slot<AsioStartStop>(table, 7);
        driver._stop = Slot<AsioStartStop>(table, 8);
        driver._channels = Slot<AsioGetChannels>(table, 9);
        driver._bufferSize = Slot<AsioGetBufferSize>(table, 11);
        driver._canRate = Slot<AsioSampleRateQuery>(table, 12);
        driver._setRate = Slot<AsioSetSampleRate>(table, 14);
        driver._channelInfo = Slot<AsioChannelInfoQuery>(table, 18);
        driver._create = Slot<AsioCreateBuffers>(table, 19);
        return driver;
    }

    public bool Init(IntPtr window) => _init!(_com, window) == 1;

    public string Error()
    {
        var text = new StringBuilder(256);
        _error!(_com, text);
        return text.ToString();
    }

    public void GetChannels(out int inputs, out int outputs) =>
        Check(_channels!(_com, out inputs, out outputs), "getChannels");

    public int ChannelInfo(int channel, bool input)
    {
        var info = new ChannelDetails { Channel = channel, IsInput = input ? 1 : 0, Name = "" };
        Check(_channelInfo!(_com, ref info), "getChannelInfo");
        return info.Type;
    }

    public bool CanSampleRate(double rate) => Fine(_canRate!(_com, rate));

    public bool SetSampleRate(double rate) => Fine(_setRate!(_com, rate));

    public void GetBufferSize(out int min, out int max, out int preferred, out int granularity) =>
        Check(_bufferSize!(_com, out min, out max, out preferred, out granularity), "getBufferSize");

    public void CreateBuffers(IntPtr infos, int channels, int frames, IntPtr callbacks) =>
        Check(_create!(_com, infos, channels, frames, callbacks), "createBuffers");

    public void Start() => Check(_start!(_com), "start");

    public void Stop() => _stop!(_com);

    public void DisposeBuffers() => Slot<AsioStartStop>(Marshal.ReadIntPtr(_com), 20)(_com);

    public void Dispose()
    {
        if (_com == IntPtr.Zero) return;
        Marshal.Release(_com);
        _com = IntPtr.Zero;
    }

    static bool Fine(AsioError error) => error is AsioError.Ok or AsioError.Success;

    void Check(AsioError error, string method)
    {
        if (Fine(error)) return;
        throw new InvalidOperationException($"FlexASIO {method} returned {error}. {Error()}");
    }

    static T Slot<T>(IntPtr table, int index) where T : Delegate =>
        Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(table, index * IntPtr.Size));

    [DllImport("ole32.dll")]
    static extern int CoCreateInstance(ref Guid clsid, IntPtr inner, uint context, ref Guid iid, out IntPtr instance);

    enum AsioError
    {
        Ok = 0,
        Success = 0x3f4847a0,
        NotPresent = -1000
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4, CharSet = CharSet.Ansi)]
    struct ChannelDetails
    {
        public int Channel;
        public int IsInput;
        public int IsActive;
        public int Group;
        public int Type;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string Name;
    }

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate int AsioInit(IntPtr self, IntPtr window);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate void AsioGetText(IntPtr self, StringBuilder text);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate AsioError AsioStartStop(IntPtr self);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate AsioError AsioGetChannels(IntPtr self, out int inputs, out int outputs);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate AsioError AsioGetBufferSize(IntPtr self, out int min, out int max, out int preferred, out int granularity);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate AsioError AsioSampleRateQuery(IntPtr self, double rate);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate AsioError AsioSetSampleRate(IntPtr self, double rate);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate AsioError AsioChannelInfoQuery(IntPtr self, ref ChannelDetails info);

    [UnmanagedFunctionPointer(CallingConvention.ThisCall)]
    delegate AsioError AsioCreateBuffers(IntPtr self, IntPtr infos, int channels, int frames, IntPtr callbacks);
}
