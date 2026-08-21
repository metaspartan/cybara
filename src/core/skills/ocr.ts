import { windowsOcrText } from "../ocr-windows";

const OCR_PROCESS_TIMEOUT_MS = 5_000;

export async function handleOcr(args: Record<string, unknown>): Promise<unknown> {
  const path = args.path as string;
  const language = (args.language as string) || "eng";

  if (!path) {
    throw new Error("Image path is required");
  }

  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }

  try {
    const result = Bun.spawnSync(["tesseract", path, "stdout", "-l", language], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: OCR_PROCESS_TIMEOUT_MS,
    });

    if (result.exitCode === 0) {
      const text = result.stdout.toString().trim();
      return {
        text,
        confidence: null,
        method: "tesseract",
        language,
      };
    }
  } catch {
    void 0;
  }

  if (process.platform === "win32") {
    const text = windowsOcrText(path);
    if (text) {
      return { text, method: "windows_ocr" };
    }
    throw new Error(
      "OCR failed. Install tesseract (winget install tesseract-ocr.tesseract) or ensure a Windows OCR language pack is installed."
    );
  }

  if (process.platform !== "darwin") {
    throw new Error("OCR failed. Install tesseract (e.g. apt install tesseract-ocr).");
  }

  try {
    const script = `on run argv
      set imgPath to item 1 of argv
      tell application "Shortcuts Events"
        run shortcut "Extract Text from Image" with input (POSIX file imgPath as alias)
      end tell
    end run`;

    const result = Bun.spawnSync(["osascript", "-e", script, path], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: OCR_PROCESS_TIMEOUT_MS,
    });

    if (result.exitCode === 0) {
      const text = result.stdout.toString().trim();
      if (text && text !== "") {
        return {
          text,
          method: "macos_vision",
        };
      }
    }
  } catch {
    void 0;
  }

  try {
    const pythonScript = `
import sys
import Vision
import Quartz
from Foundation import NSURL

def extract_text(image_path):
    url = NSURL.fileURLWithPath_(image_path)
    source = Quartz.CGImageSourceCreateWithURL(url, None)
    if not source:
        return ""
    
    image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)
    if not image:
        return ""
    
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image, None)
    handler.performRequests_error_([request], None)
    
    results = []
    for observation in request.results() or []:
        results.append(observation.topCandidates_(1)[0].string())
    
    return "\\n".join(results)

print(extract_text(sys.argv[1]))
`;

    const result = Bun.spawnSync(["python3", "-c", pythonScript, path], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: OCR_PROCESS_TIMEOUT_MS,
    });

    if (result.exitCode === 0) {
      const text = result.stdout.toString().trim();
      if (text) {
        return {
          text,
          method: "macos_vision_python",
        };
      }
    }
  } catch {
    void 0;
  }

  throw new Error(
    "OCR failed. Install tesseract (brew install tesseract) or ensure macOS Shortcuts is configured with 'Extract Text from Image' shortcut."
  );
}

export async function handleImageDescribe(args: Record<string, unknown>): Promise<unknown> {
  const path = args.path as string;

  if (!path) {
    throw new Error("Image path is required");
  }

  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }

  if (process.platform === "darwin") {
    try {
      const result = Bun.spawnSync(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", path],
        {
          stdout: "pipe",
        }
      );

      if (result.exitCode === 0) {
        const output = result.stdout.toString();
        const width = output.match(/pixelWidth:\s*(\d+)/)?.[1];
        const height = output.match(/pixelHeight:\s*(\d+)/)?.[1];
        const format = output.match(/format:\s*(\w+)/)?.[1];

        return {
          width: width ? parseInt(width, 10) : null,
          height: height ? parseInt(height, 10) : null,
          format: format || null,
          path,
        };
      }
    } catch {
      void 0;
    }
  } else if (process.platform === "win32") {
    try {
      const psScript = `Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${path.replace(/'/g, "''")}'); Write-Output "$($img.Width) $($img.Height) $($img.RawFormat)"; $img.Dispose()`;
      const result = Bun.spawnSync(["powershell", "-NoProfile", "-Command", psScript], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15000,
      });
      if (result.exitCode === 0) {
        const [width, height, format] = result.stdout.toString().trim().split(/\s+/);
        return {
          width: width ? parseInt(width, 10) : null,
          height: height ? parseInt(height, 10) : null,
          format: format || null,
          path,
        };
      }
    } catch {
      void 0;
    }
  } else {
    try {
      const result = Bun.spawnSync(["identify", "-format", "%w %h %m", path], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode === 0) {
        const [width, height, format] = result.stdout.toString().trim().split(/\s+/);
        return {
          width: width ? parseInt(width, 10) : null,
          height: height ? parseInt(height, 10) : null,
          format: format || null,
          path,
        };
      }
    } catch {
      void 0;
    }
  }

  return {
    error: "Could not get image info",
    path,
  };
}
