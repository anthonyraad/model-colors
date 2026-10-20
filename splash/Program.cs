using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace ModelColorsSplash;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var here = AppContext.BaseDirectory;
        var imagePath = Path.GetFullPath(Path.Combine(here, "..", "..", "build", "splash.png"));
        var unpacked = Path.GetFullPath(Path.Combine(here, "..", "win-unpacked"));
        var appPath = Directory.Exists(unpacked)
            ? Directory.EnumerateFiles(unpacked, "*.exe").FirstOrDefault(path =>
                !string.Equals(Path.GetFileName(path), "elevate.exe", StringComparison.OrdinalIgnoreCase))
            : null;

        if (appPath == null || !File.Exists(imagePath))
        {
            if (appPath != null) StartApp(appPath);
            return;
        }

        Application.Run(new SplashForm(imagePath, appPath));
    }

    internal static void StartApp(string appPath)
    {
        var start = new ProcessStartInfo(appPath)
        {
            WorkingDirectory = Path.GetDirectoryName(appPath) ?? "",
            UseShellExecute = false
        };
        start.Environment["CYCLES_SPLASH"] = "0";
        Process.Start(start);
    }
}

internal sealed class SplashForm : Form
{
    private readonly string _appPath;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 80 };
    private Process? _app;
    private int _ticks;

    public SplashForm(string imagePath, string appPath)
    {
        _appPath = appPath;
        using var image = new Bitmap(imagePath);
        var shown = new Bitmap(image);
        AutoScaleMode = AutoScaleMode.None;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = false;
        TopMost = true;
        ControlBox = false;
        ClientSize = shown.Size;
        BackgroundImage = shown;
        BackgroundImageLayout = ImageLayout.None;
        BackColor = Color.FromArgb(204, 204, 204);

        Shown += (_, _) =>
        {
            _app = Start();
            _timer.Tick += (_, _) => Watch();
            _timer.Start();
        };
    }

    private Process? Start()
    {
        var start = new ProcessStartInfo(_appPath)
        {
            WorkingDirectory = Path.GetDirectoryName(_appPath) ?? "",
            UseShellExecute = false
        };
        start.Environment["CYCLES_SPLASH"] = "0";
        return Process.Start(start);
    }

    private void Watch()
    {
        _ticks++;
        if (EditorVisible() || _app is { HasExited: true } || _ticks > 400)
        {
            _timer.Stop();
            Close();
        }
    }

    private static bool EditorVisible()
    {
        var found = false;
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            var title = new StringBuilder(256);
            _ = GetWindowText(hwnd, title, title.Capacity);
            if (title.ToString() != "Model:Colors") return true;
            found = true;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
}
