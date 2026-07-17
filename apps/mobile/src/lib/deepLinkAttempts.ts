export class DeepLinkAttemptTracker {
  private readonly completed = new Set<string>();
  private readonly inFlight = new Set<string>();

  begin(url: string): boolean {
    if (this.completed.has(url) || this.inFlight.has(url)) return false;
    this.inFlight.add(url);
    return true;
  }

  complete(url: string): void {
    this.completed.add(url);
  }

  finish(url: string): void {
    this.inFlight.delete(url);
  }
}
