export function windowsOcrText(imagePath: string): string | null {
  if (process.platform !== "win32") return null;
  const psScript = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]

$path = '${imagePath.replace(/'/g, "''")}'
$stream = [System.IO.File]::OpenRead($path)
$decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync([System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($stream)).GetAwaiter().GetResult()
$bitmap = $decoder.GetSoftwareBitmapAsync().GetAwaiter().GetResult()
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = $engine.RecognizeAsync($bitmap).GetAwaiter().GetResult()
Write-Output $result.Text
$stream.Dispose()
`;
  try {
    const result = Bun.spawnSync(["powershell", "-NoProfile", "-Command", psScript], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    });
    if (result.exitCode !== 0) return null;
    const text = result.stdout.toString().trim();
    return text || null;
  } catch {
    return null;
  }
}
