import thinkingPose1Url from "../../public/cybara-thinking-1.png";
import thinkingPose2Url from "../../public/cybara-thinking-2.png";
import thinkingPose3Url from "../../public/cybara-thinking-3.png";
import thinkingPose4Url from "../../public/cybara-thinking-4.png";
import thinkingPose5Url from "../../public/cybara-thinking-5.png";

const THINKING_POSES = [
  thinkingPose1Url,
  thinkingPose2Url,
  thinkingPose3Url,
  thinkingPose4Url,
  thinkingPose5Url,
];

function preloadThinkingPoses(): void {
  if (typeof Image === "undefined") return;
  for (const source of THINKING_POSES) {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
  }
}

preloadThinkingPoses();

export function CybaraThinkingMark() {
  return (
    <span className="cybara-thinking-mark" aria-hidden="true">
      {THINKING_POSES.map((source, index) => (
        <img
          key={source}
          src={source}
          alt=""
          draggable={false}
          decoding="async"
          className={`cybara-thinking-mark-frame cybara-thinking-mark-pose-${index + 1}`}
        />
      ))}
    </span>
  );
}
