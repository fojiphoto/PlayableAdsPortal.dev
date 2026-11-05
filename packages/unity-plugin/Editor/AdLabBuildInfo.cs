namespace FactorialAdLab.Editor
{
    /// <summary>
    /// Version of this plugin build. Keep <see cref="Version"/> in step with package.json — the
    /// server's tests check it. Downloads from the dashboard stamp their licence code into
    /// <see cref="Watermark"/>; a copy installed from source leaves it empty.
    /// </summary>
    internal static class AdLabBuildInfo
    {
        public const string Version = "0.2.1";
        public const string Watermark = "";
    }
}
