import Foundation

struct GatewayComputerUseTrajectorySettings: Decodable, Hashable {
    let driverCommand: String
    let trajectoryCaptureEnabled: Bool
    let trajectoryVideoEnabled: Bool
}

struct GatewayComputerUseTrajectorySummary: Decodable, Identifiable, Hashable {
    let id: String
    let sessionId: String
    let status: String
    let recordVideo: Bool
    let createdAt: String
    let updatedAt: String
    let completedAt: String?
    let error: String?
    let replayOf: String?
    let turnCount: Int
    let screenshotCount: Int
    let clickCount: Int
    let durationMs: Int
    let videoAvailable: Bool
}

struct GatewayComputerUseTrajectoriesResponse: Decodable, Hashable {
    let trajectories: [GatewayComputerUseTrajectorySummary]
    let activeId: String?
    let settings: GatewayComputerUseTrajectorySettings
}

struct GatewayComputerUseTrajectoryReplayResponse: Decodable, Hashable {
    let success: Bool
    let result: String?
}
