export interface DriverRecordingGate {
  trajectoryVideoEnabled: boolean;
  driverReady: boolean;
  hasStartRecordingTool: boolean;
  surface: string;
  driverStartRecordingReliable: boolean;
}

export function shouldStartDriverVideoRecording(gate: DriverRecordingGate): boolean {
  return (
    gate.trajectoryVideoEnabled &&
    gate.driverReady &&
    gate.hasStartRecordingTool &&
    gate.driverStartRecordingReliable &&
    gate.surface === "desktop"
  );
}

export interface DriverCapabilityProbe {
  listedToolNames: string[];
  startRecordingResponds: boolean;
}

export function isDriverStartRecordingReliable(probe: DriverCapabilityProbe): boolean {
  return probe.listedToolNames.includes("start_recording") && probe.startRecordingResponds;
}
