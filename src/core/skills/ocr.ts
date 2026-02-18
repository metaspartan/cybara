
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
        });

        if (result.exitCode === 0) {
            const text = result.stdout.toString().trim();
            return {
                text,
                confidence: null, // tesseract stdout doesn't include confidence
                method: "tesseract",
                language,
            };
        }
    } catch {
    void 0;
    }

    try {
        const script = `
      tell application "Shortcuts Events"
        run shortcut "Extract Text from Image" with input (POSIX file "${path}" as alias)
      end tell
    `;

        const result = Bun.spawnSync(["osascript", "-e", script], {
            stdout: "pipe",
            stderr: "pipe",
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

print(extract_text("${path}"))
`;

        const result = Bun.spawnSync(["python3", "-c", pythonScript], {
            stdout: "pipe",
            stderr: "pipe",
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

    return {
        error: "Could not get image info",
        path,
    };
}
