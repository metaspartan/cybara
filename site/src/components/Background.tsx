export function Background(): React.ReactElement {
  return (
    <div className="bg" aria-hidden="true">
      <div className="bg-glow bg-glow--one" />
      <div className="bg-glow bg-glow--two" />
      <div className="bg-glow bg-glow--three" />
      <div className="bg-grid" />
      <div className="bg-noise" />
    </div>
  );
}
