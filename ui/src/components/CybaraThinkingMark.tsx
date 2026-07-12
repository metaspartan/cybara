import cybaraLogoUrl from "../../public/cybara.png";
import cybaraThinkingUrl from "../../public/cybara-thinking.png";

export function CybaraThinkingMark() {
  return (
    <span className="cybara-thinking-mark" aria-hidden="true">
      <img
        src={cybaraLogoUrl}
        alt=""
        draggable={false}
        className="cybara-thinking-mark-frame cybara-thinking-mark-awake"
      />
      <img
        src={cybaraThinkingUrl}
        alt=""
        draggable={false}
        className="cybara-thinking-mark-frame cybara-thinking-mark-resting"
      />
    </span>
  );
}
