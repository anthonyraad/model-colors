using System.Runtime.InteropServices;
using NAudio.Vst3;

namespace CyclesInsertHost;

/// <summary>
/// Native message pump. A WinForms loop deadlocks VST3 editors inside IPlugView::attached.
/// Steinberg's own editor host, and a bare message loop, do not.
/// </summary>
static class UiThread
{
    const uint WorkMessage = 0x8001;
    const string ClassName = "CyclesInsertHostPump";
    static readonly Queue<Action> Queue = new();
    static readonly object Gate = new();
    static readonly WndProc Proc = OnMessage;
    static Thread _thread = null!;
    static IntPtr _hwnd;
    static bool _registered;

    public static void Run(ThreadStart background)
    {
        _thread = Thread.CurrentThread;
        EnsureClass();
        _hwnd = CreateWindowEx(0, ClassName, "CyclesInsertHost", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
        if (_hwnd == IntPtr.Zero) throw new InvalidOperationException("Could not start the plug-in window pump.");
        var reader = new Thread(background) { IsBackground = true };
        reader.Start();
        while (GetMessage(out var message, IntPtr.Zero, 0, 0))
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
    }

    public static void Invoke(Action action)
    {
        if (Thread.CurrentThread == _thread)
        {
            action();
            return;
        }
        Exception? error = null;
        using var done = new ManualResetEventSlim(false);
        lock (Gate)
        {
            Queue.Enqueue(() =>
            {
                try { action(); }
                catch (Exception ex) { error = ex; }
                finally { done.Set(); }
            });
        }
        PostMessage(_hwnd, WorkMessage, IntPtr.Zero, IntPtr.Zero);
        done.Wait();
        if (error != null) throw new InvalidOperationException(error.Message, error);
    }

    public static void Quit()
    {
        if (Thread.CurrentThread == _thread)
        {
            PostQuitMessage(0);
            return;
        }
        Invoke(Quit);
    }

    static void EnsureClass()
    {
        if (_registered) return;
        var info = new WindowClass
        {
            WndProc = Marshal.GetFunctionPointerForDelegate(Proc),
            Instance = GetModuleHandle(null),
            ClassName = ClassName
        };
        if (RegisterClass(ref info) == 0) throw new InvalidOperationException("Could not start the plug-in window pump.");
        _registered = true;
    }

    static IntPtr OnMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (message == WorkMessage)
        {
            while (true)
            {
                Action? work;
                lock (Gate)
                {
                    if (Queue.Count == 0) break;
                    work = Queue.Dequeue();
                }
                work();
            }
            return IntPtr.Zero;
        }
        return DefWindowProc(hwnd, message, wParam, lParam);
    }

    [DllImport("user32.dll")]
    static extern bool GetMessage(out Msg message, IntPtr hwnd, uint min, uint max);

    [DllImport("user32.dll")]
    static extern bool TranslateMessage(ref Msg message);

    [DllImport("user32.dll")]
    static extern IntPtr DispatchMessage(ref Msg message);

    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern void PostQuitMessage(int code);

    struct Msg
    {
        public IntPtr Hwnd;
        public uint Message;
        public IntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int X;
        public int Y;
    }

    delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WindowClass
    {
        public uint Style;
        public IntPtr WndProc;
        public int ClassExtra;
        public int WindowExtra;
        public IntPtr Instance;
        public IntPtr Icon;
        public IntPtr Cursor;
        public IntPtr Background;
        public string? Menu;
        public string ClassName;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern ushort RegisterClass(ref WindowClass info);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);

    [DllImport("user32.dll")]
    static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string? module);
}

/// <summary>
/// A bare Win32 window for a VST3 editor. The plug-in is parented to this window itself,
/// the same way Steinberg's editor host and NAudio's working harness do it. Size messages
/// are ignored until attach has returned, so the plug-in and the window do not wait on each other.
/// </summary>
sealed class PluginEditorWindow
{
    const string ClassName = "CyclesInsertEditor";
    const uint WsOverlappedWindow = 0x00CF0000;
    const uint WmSize = 0x0005;
    const uint WmClose = 0x0010;
    const uint SwpNoMove = 0x0002;
    const uint SwpNoZOrder = 0x0004;
    static readonly IntPtr HwndTop = new(0);

    static readonly WndProc Proc = OnMessage;
    static readonly Dictionary<IntPtr, PluginEditorWindow> OpenWindows = new();
    static bool _registered;

    readonly Vst3PluginView _view;
    readonly Action _closed;
    IntPtr _hwnd;
    bool _closedFlag;
    bool _fitting;
    bool _ready;

    PluginEditorWindow(Vst3PluginView view, Action closed)
    {
        _view = view;
        _closed = closed;
    }

    public static PluginEditorWindow Open(string title, Vst3PluginView view, Action closed)
    {
        var window = new PluginEditorWindow(view, closed);
        try
        {
            window.Create(title);
        }
        catch
        {
            window.Close();
            throw;
        }
        return window;
    }

    public static void CloseAll()
    {
        foreach (var window in OpenWindows.Values.ToArray()) window.Close();
    }

    public void BringToFront()
    {
        if (_hwnd == IntPtr.Zero) return;
        ShowWindow(_hwnd, 9);
        SetForegroundWindow(_hwnd);
    }

    void Create(string title)
    {
        EnsureClass();
        _hwnd = CreateWindowEx(0, ClassName, title, WsOverlappedWindow, 120, 80, 400, 300, IntPtr.Zero, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
        if (_hwnd == IntPtr.Zero) throw new InvalidOperationException("Could not open a window for this plug-in.");
        OpenWindows[_hwnd] = this;
        var dpi = GetDpiForWindow(_hwnd);
        var scale = dpi > 0 ? dpi / 96f : 1f;
        _view.Resized += (_, requested) => Fit(requested.Width, requested.Height);
        _view.AttachTo(_hwnd, scale);
        var size = _view.GetSize();
        if (size.Width >= 80 && size.Height >= 40) Fit(size.Width, size.Height);
        _ready = true;
        ShowWindow(_hwnd, 5);
        UpdateWindow(_hwnd);
        SetWindowText(_hwnd, title);
        SetForegroundWindow(_hwnd);
    }

    public void Close()
    {
        if (_closedFlag) return;
        _closedFlag = true;
        _ready = false;
        try { _view.Detach(); } catch { /* the parent is going away */ }
        try { _view.Dispose(); } catch { /* already released */ }
        OpenWindows.Remove(_hwnd);
        if (_hwnd != IntPtr.Zero) DestroyWindow(_hwnd);
        _hwnd = IntPtr.Zero;
        _closed();
    }

    void Fit(int width, int height)
    {
        if (_fitting || width < 1 || height < 1 || _hwnd == IntPtr.Zero) return;
        _fitting = true;
        var rect = new Rect { Right = width, Bottom = height };
        AdjustWindowRectEx(ref rect, WsOverlappedWindow, false, 0);
        SetWindowPos(_hwnd, HwndTop, 0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top, SwpNoMove | SwpNoZOrder);
        _fitting = false;
    }

    void OnSized(int width, int height)
    {
        if (!_ready || _fitting || width < 1 || height < 1) return;
        _view.SetSize(width, height);
    }

    static void EnsureClass()
    {
        if (_registered) return;
        var info = new WindowClassEx
        {
            Size = (uint)Marshal.SizeOf<WindowClassEx>(),
            Style = 0x0008,
            WndProc = Marshal.GetFunctionPointerForDelegate(Proc),
            Instance = GetModuleHandle(null),
            Cursor = LoadCursor(IntPtr.Zero, 32512),
            Background = new IntPtr(16),
            ClassName = ClassName
        };
        if (RegisterClassEx(ref info) == 0) throw new InvalidOperationException("Could not prepare a window for plug-in editors.");
        _registered = true;
    }

    static IntPtr OnMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (OpenWindows.TryGetValue(hwnd, out var window))
        {
            if (message == WmSize)
            {
                var width = (int)(lParam.ToInt64() & 0xFFFF);
                var height = (int)((lParam.ToInt64() >> 16) & 0xFFFF);
                window.OnSized(width, height);
                return IntPtr.Zero;
            }
            if (message == WmClose)
            {
                window.Close();
                return IntPtr.Zero;
            }
        }
        return DefWindowProc(hwnd, message, wParam, lParam);
    }

    delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WindowClassEx
    {
        public uint Size;
        public uint Style;
        public IntPtr WndProc;
        public int ClassExtra;
        public int WindowExtra;
        public IntPtr Instance;
        public IntPtr Icon;
        public IntPtr Cursor;
        public IntPtr Background;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Menu;
        [MarshalAs(UnmanagedType.LPWStr)] public string ClassName;
        public IntPtr SmallIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, EntryPoint = "RegisterClassExW", SetLastError = true)]
    static extern ushort RegisterClassEx(ref WindowClassEx info);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, EntryPoint = "CreateWindowExW", SetLastError = true)]
    static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, EntryPoint = "DefWindowProcW")]
    static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    static extern bool UpdateWindow(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SetWindowTextW")]
    static extern bool SetWindowText(IntPtr hwnd, string text);


    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    static extern bool MoveWindow(IntPtr hwnd, int x, int y, int width, int height, bool repaint);

    [DllImport("user32.dll")]
    static extern bool GetClientRect(IntPtr hwnd, out Rect rect);

    [DllImport("user32.dll")]
    static extern bool AdjustWindowRectEx(ref Rect rect, uint style, bool menu, uint exStyle);

    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    static extern uint GetDpiForWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    static extern IntPtr LoadCursor(IntPtr instance, int cursor);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string? module);
}
