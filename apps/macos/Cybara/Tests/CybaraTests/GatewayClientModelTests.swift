import XCTest

@testable import Cybara

final class GatewayClientModelTests: XCTestCase {

    func testNativeGatewayCredentialsPreferEnvironmentAndNormalizeValues() {
        XCTAssertEqual(
            GatewayClient.resolveAPIKey(
                environment: ["CYBARA_API_KEY": " env-key "],
                fileValue: "file-key\n"
            ),
            "env-key"
        )
        XCTAssertEqual(
            GatewayClient.resolveAPIKey(environment: [:], fileValue: " file-key\n"),
            "file-key"
        )
        XCTAssertNil(GatewayClient.resolveAPIKey(environment: [:], fileValue: "  "))
        XCTAssertEqual(
            GatewayClient.resolveGatewayPassword(
                environment: ["CYBARA_GATEWAY_PASSWORD": " env-password "],
                storedValue: "stored-password"
            ),
            "env-password"
        )
    }

    func testNativeGatewayErrorsExplainAuthenticationRecovery() {
        XCTAssertEqual(
            GatewayClientError.response(statusCode: 401, body: "").errorDescription,
            "Gateway authentication failed. Check CYBARA_API_KEY or ~/.cybara/api_key."
        )
        XCTAssertEqual(
            GatewayClientError.response(statusCode: 403, body: "").errorDescription,
            "Gateway access was denied. Check the gateway password and access settings."
        )
        XCTAssertEqual(
            GatewayClientError.response(statusCode: 500, body: "failure").errorDescription,
            "Gateway error 500: failure"
        )
    }

    func testPathSegmentEncodesRouteSeparators() throws {
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:4269"))
        let client = GatewayClient(baseURL: url)
        XCTAssertEqual(client.pathSegment("../../wallet"), "..%2F..%2Fwallet")
        XCTAssertFalse(client.pathSegment("../../wallet").contains("/"))
    }

    func testEvalModelsDecodeSummaryAndLatestRun() throws {
        let data = Data(
            #"{"goldens":[{"id":"golden-1","name":"Read version","description":null,"tags":["repo"],"baseline":{"sessionId":"session-1","turnIndex":0,"provider":"openai","model":"gpt-5.4-mini","request":{"userMessage":{"content":"Read package.json"},"workspaceDir":"/tmp/repo"},"structure":{"tools":[{"name":"read","status":"completed"}]}}}],"runs":[{"id":"run-1","goldenId":"golden-1","replaySessionId":"replay-1","status":"passed","score":100,"error":null}]}"#.utf8
        )
        let response = try JSONDecoder().decode(GatewayEvalsResponse.self, from: data)
        XCTAssertEqual(response.goldens.first?.baseline.request.userMessage.content, "Read package.json")
        XCTAssertEqual(response.goldens.first?.baseline.structure.tools.first?.name, "read")
        XCTAssertEqual(response.runs.first?.score, 100)
    }

    func testComputerUseTrajectoryModelsDecodeCaptureAndReplayData() throws {
        let data = Data(
            #"{"trajectories":[{"id":"trajectory-1","sessionId":"session-1","status":"completed","recordVideo":true,"createdAt":"2026-07-13T00:00:00.000Z","updatedAt":"2026-07-13T00:00:03.000Z","completedAt":"2026-07-13T00:00:03.000Z","error":null,"replayOf":null,"turnCount":3,"screenshotCount":3,"clickCount":2,"durationMs":3000,"videoAvailable":true}],"activeId":null,"settings":{"driverCommand":"cua-driver","trajectoryCaptureEnabled":true,"trajectoryVideoEnabled":true}}"#.utf8
        )
        let response = try JSONDecoder().decode(GatewayComputerUseTrajectoriesResponse.self, from: data)
        XCTAssertEqual(response.trajectories.first?.turnCount, 3)
        XCTAssertEqual(response.trajectories.first?.clickCount, 2)
        XCTAssertTrue(response.settings.trajectoryCaptureEnabled)
        XCTAssertTrue(response.settings.trajectoryVideoEnabled)
    }

    func testNativeLSPModelsDecodeIncludedAndActiveServers() throws {
        let statusData = Data(
            #"{"status":"ok","workspace":"/tmp/project","supported":["typescript"],"active":[{"id":"typescript","name":"TypeScript","command":"vtsls","initialized":true}],"diagnosticsCount":2}"#.utf8
        )
        let status = try JSONDecoder().decode(NativeLSPStatus.self, from: statusData)
        XCTAssertEqual(status.active?.first?.name, "TypeScript")
        XCTAssertTrue(status.active?.first?.initialized == true)

        let installData = Data(
            #"{"status":[{"language":"typescript","installed":true,"available":true,"bundled":false,"preinstalled":true,"path":"/app/node_modules/@vtsls/language-server/bin/vtsls.js"}]}"#.utf8
        )
        let installStatus = try JSONDecoder().decode(NativeLSPInstallStatusResponse.self, from: installData)
        XCTAssertTrue(installStatus.status.first?.preinstalled == true)
    }

    func testNativeSpeechStatusDecodesVoiceReadiness() throws {
        let data = Data(
            #"{"success":true,"tts":{"ready":true,"provider":"Kokoro 82M","type":"local","systemFallback":false,"error":null},"stt":{"ready":true,"provider":"Native dictation","type":"native","native":true,"error":null},"settings":{"ttsProvider":"local","ttsVoice":"af_heart","sttProvider":"native","realtimeProvider":"managed"}}"#.utf8
        )
        let status = try JSONDecoder().decode(NativeSpeechStatusResponse.self, from: data)

        XCTAssertTrue(status.ttsReady)
        XCTAssertTrue(status.sttReady)
        XCTAssertTrue(status.stt?.native == true)
        XCTAssertEqual(status.settings?.sttProvider, "native")
        XCTAssertEqual(status.dictationProvider, "native")
    }

    func testNativeSpeechStatusTreatsSystemFallbackAsReady() throws {
        let data = Data(
            #"{"tts":{"ready":false,"provider":"System voice","type":"system","systemFallback":true,"error":null},"stt":{"ready":false,"provider":null,"type":null,"native":false,"error":"Missing provider"}}"#.utf8
        )
        let status = try JSONDecoder().decode(NativeSpeechStatusResponse.self, from: data)

        XCTAssertTrue(status.ttsReady)
        XCTAssertFalse(status.sttReady)
    }

    func testNativeSpeechStatusRoutesAutomaticWhisperToLocalTranscription() throws {
        let data = Data(
            #"{"tts":{"ready":true,"provider":"System voice","type":"system","systemFallback":true,"error":null},"stt":{"ready":true,"provider":"Whisper (local)","type":"local","native":false,"error":null},"settings":{"sttProvider":"auto"}}"#.utf8
        )
        let status = try JSONDecoder().decode(NativeSpeechStatusResponse.self, from: data)

        XCTAssertEqual(status.dictationProvider, "local")
    }

    func testSessionForkAndRuntimeMetricsDecodeGatewayResponses() throws {
        let forkData = Data(
            #"{"success":true,"fork":{"sessionId":"fork-1","sourceSessionId":"source-1","agentId":"agent-1","messageCount":3,"workspaceDir":"/tmp/project","title":"Forked chat"}}"#.utf8
        )
        let fork = try JSONDecoder().decode(GatewaySessionForkResponse.self, from: forkData)
        XCTAssertTrue(fork.success)
        XCTAssertEqual(fork.fork?.sessionId, "fork-1")
        XCTAssertEqual(fork.fork?.messageCount, 3)

        let metricsData = Data(
            #"{"totals":{"sessions":1,"inputTokens":200,"outputTokens":100,"cachedInputTokens":50,"cacheWriteTokens":20,"totalTokens":300,"callCount":2,"tokensPerSecond":25.5,"firstTokenMs":420,"compactionCount":1},"sessions":[{"sessionId":"source-1","title":"Runtime test","provider":"minimax","model":"MiniMax-M3","inputTokens":200,"outputTokens":100,"cachedInputTokens":50,"cacheWriteTokens":20,"totalTokens":300,"callCount":2,"tokensPerSecond":25.5,"firstTokenMs":420,"compactionCount":1}]}"#.utf8
        )
        let metrics = try JSONDecoder().decode(NativeSessionRuntimeMetrics.self, from: metricsData)
        XCTAssertEqual(metrics.totals.firstTokenMs, 420)
        XCTAssertEqual(metrics.totals.cacheWriteTokens, 20)
        XCTAssertEqual(metrics.sessions.first?.cachedInputTokens, 50)
        XCTAssertEqual(metrics.sessions.first?.cacheWriteTokens, 20)
        XCTAssertEqual(metrics.sessions.first?.model, "MiniMax-M3")
    }

    func testNativeChatAgentLabelUsesModelOnlyInCompactLayout() {
        XCTAssertEqual(
            nativeChatAgentLabel(name: "Research", model: "gpt-5.4-mini", compact: false),
            "Research - gpt-5.4-mini"
        )
        XCTAssertEqual(
            nativeChatAgentLabel(name: "Research", model: "gpt-5.4-mini", compact: true),
            "gpt-5.4-mini"
        )
        XCTAssertEqual(nativeChatAgentLabel(name: "Research", model: nil, compact: true), "Research")
    }

    func testNativeReasoningEffortSliderMapping() {
        XCTAssertEqual(nativeReasoningEffortIndex(""), 0)
        XCTAssertEqual(nativeReasoningEffortIndex("medium"), 3)
        XCTAssertEqual(nativeReasoningEffortValue(4), "high")
        XCTAssertEqual(nativeReasoningEffortValue(20), "max")
    }

    func testNativeReasoningOptionsFollowProviderModelCapabilities() {
        XCTAssertEqual(
            nativeSupportedReasoningEfforts(provider: "openai", model: "gpt-5.6-sol").map(\.value),
            ["", "low", "medium", "high", "xhigh", "max"]
        )
        XCTAssertEqual(
            nativeSupportedReasoningEfforts(provider: "anthropic", model: "claude-sonnet-4-6").map(\.value),
            ["", "low", "medium", "high", "max"]
        )
        XCTAssertEqual(
            nativeSupportedReasoningEfforts(provider: "google", model: "gemini-3.1-pro-preview").map(\.value),
            ["", "low", "high"]
        )
        XCTAssertEqual(
            nativeSupportedReasoningEfforts(provider: "minimax", model: "MiniMax-M3").map(\.label),
            ["Adaptive"]
        )
    }

    func testSessionDisplayTitleTrimsGatewayTitle() throws {
        let session = try decodeSession(#"{"id":"session-123456789","title":"  Release planning  "}"#)

        XCTAssertEqual(session.displayTitle, "Release planning")
    }

    func testSessionDisplayTitleStripsMatchingAgentPrefix() throws {
        let session = try decodeSession(
            #"{"id":"session-123456789","title":"Mini: Audit agent platform","agent_name":"Mini"}"#
        )
        let ordinary = try decodeSession(
            #"{"id":"session-123456789","title":"Fix: CI workflow failures","agent_name":"Mini"}"#
        )
        let legacyDifferentAgent = try decodeSession(
            #"{"id":"session-123456789","title":"Codex: Review release build","agent_name":"Zai"}"#
        )

        XCTAssertEqual(session.displayTitle, "Audit agent platform")
        XCTAssertEqual(ordinary.displayTitle, "Fix: CI workflow failures")
        XCTAssertEqual(legacyDifferentAgent.displayTitle, "Review release build")
    }

    func testSessionDisplayTitleFallsBackForBlankOrMissingTitle() throws {
        let blank = try decodeSession(#"{"id":"session-abcdef123","title":"   "}"#)
        let missing = try decodeSession(#"{"id":"session-fedcba987"}"#)

        XCTAssertEqual(blank.displayTitle, "session-")
        XCTAssertEqual(missing.displayTitle, "session-")
    }

    func testSessionProviderModelSummaryUsesGatewayMetadata() throws {
        let session = try decodeSession(
            #"""
            {
              "id": "session-123",
              "agent_id": "agent-local",
              "provider": "openai",
              "provider_name": "OpenAI",
              "model": "gpt-4.1",
              "agent_name": "Main Assistant",
              "last_message": {
                "role": "assistant",
                "content": "Latest reply"
              }
            }
            """#
        )

        XCTAssertEqual(session.providerModelSummary, "OpenAI · gpt-4.1")
        XCTAssertEqual(session.providerModelAndAgentSummary, "OpenAI · gpt-4.1 · via Main Assistant")
        XCTAssertEqual(session.last_message?.preview, "Latest reply")
    }

    func testSessionProviderModelSummaryFallsBackWithoutIds() throws {
        let routed = try decodeSession(#"{"id":"session-1","agent_id":"agent-123"}"#)
        let unrouted = try decodeSession(#"{"id":"session-2"}"#)

        XCTAssertEqual(routed.providerModelSummary, "Agent agent-123")
        XCTAssertEqual(unrouted.providerModelSummary, "Local gateway routing")
        XCTAssertFalse(routed.providerModelAndAgentSummary.contains("Agent routed"))
    }

    func testSessionRouteSummaryResolvesAgentProviderAndModel() throws {
        let session = try decodeSession(#"{"id":"session-1","agent_id":"agent-1"}"#)
        let agent = try decodeAgent(
            #"{"id":"agent-1","name":"Research","type":"research","model":"gpt-5-mini","provider_id":"provider-1"}"#
        )
        let provider = try decodeProvider(#"{"id":"provider-1","name":"OpenAI","provider":"openai"}"#)

        XCTAssertEqual(
            gatewaySessionRouteSummary(session, agents: [agent], providers: [provider]),
            "OpenAI · gpt-5-mini · via Research"
        )
    }

    func testSessionDecodesChatEndpointCamelCaseFields() throws {
        let session = try decodeSession(
            #"""
            {
              "id": "session-1",
              "agentId": "agent-1",
              "useModelRouter": true,
              "messageCount": 3,
              "createdAt": "2026-07-02T18:00:00.000Z",
              "updatedAt": "2026-07-02T18:03:00.000Z",
              "workspaceDir": "/Users/carsen/Documents/GitHub/cybara",
              "lastMessage": {
                "role": "assistant",
                "content": "Latest response"
              }
            }
            """#
        )

        XCTAssertEqual(session.agent_id, "agent-1")
        XCTAssertEqual(session.use_model_router, true)
        XCTAssertEqual(session.message_count, 3)
        XCTAssertEqual(session.created_at, "2026-07-02T18:00:00.000Z")
        XCTAssertEqual(session.updated_at, "2026-07-02T18:03:00.000Z")
        XCTAssertEqual(session.workspace_dir, "/Users/carsen/Documents/GitHub/cybara")
        XCTAssertEqual(session.last_message?.preview, "Latest response")
        XCTAssertEqual(session.workspaceLabel, gatewayWorkspaceLabel("/Users/carsen/Documents/GitHub/cybara"))
    }

    func testWorkspaceLabelTruncatesLongPathsLikeWebUI() {
        let longPath = "/Users/carsen/Documents/GitHub/cybara/apps/macos/Cybara"
        let label = gatewayWorkspaceLabel(longPath, maxLength: 32)

        XCTAssertNotNil(label)
        XCTAssertLessThanOrEqual(label?.count ?? 0, 32)
        XCTAssertTrue(label?.contains(".../") == true)
        XCTAssertTrue(label?.hasSuffix("Cybara") == true)
        XCTAssertEqual(gatewayWorkspaceLabel("/tmp/cybara", maxLength: 32), "/tmp/cybara")
        XCTAssertNil(gatewayWorkspaceLabel("   "))
    }

    func testWorkspaceFolderNameMatchesOpenInMenu() {
        XCTAssertEqual(gatewayWorkspaceFolderName("/Users/carsen/Documents/GitHub/cybara"), "cybara")
        XCTAssertEqual(gatewayWorkspaceFolderName("C:\\Users\\Carsen\\Projects\\cybara"), "cybara")
        XCTAssertEqual(gatewayWorkspaceFolderName("/tmp/cybara/"), "cybara")
        XCTAssertNil(gatewayWorkspaceFolderName("   "))
    }

    func testWorkspaceOpenTargetDecodesIconURL() throws {
        let target = try JSONDecoder().decode(
            NativeWorkspaceOpenTarget.self,
            from: Data(
                #"""
                {
                  "id": "zed",
                  "label": "Zed",
                  "kind": "ide",
                  "icon": "zed",
                  "iconUrl": "data:image/png;base64,AAAA",
                  "available": true
                }
                """#.utf8
            )
        )

        XCTAssertEqual(target.iconUrl, "data:image/png;base64,AAAA")
    }

    func testChatSendResponseDecodesWorkspaceDir() throws {
        let response = try JSONDecoder().decode(
            ChatSendResponse.self,
            from: Data(
                #"""
                {
                  "sessionId": "session-1",
                  "workspaceDir": "/Users/carsen/Documents/GitHub/cybara",
                  "message": {
                    "role": "assistant",
                    "content": "Done."
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(response.sessionId, "session-1")
        XCTAssertEqual(response.workspaceDir, "/Users/carsen/Documents/GitHub/cybara")
        XCTAssertEqual(response.response, "Done.")
    }

    func testChatSendResponseDecodesQueuedPendingMessages() throws {
        let response = try JSONDecoder().decode(
            ChatSendResponse.self,
            from: Data(
                #"""
                {
                  "sessionId": "session-1",
                  "queued": true,
                  "pendingMessage": {
                    "id": "pending-1",
                    "sessionId": "session-1",
                    "clientPendingId": "optimistic-native-1",
                    "content": "follow up",
                    "createdAt": 1783015200700,
                    "updatedAt": 1783015200701,
                    "mode": "queued",
                    "sequence": 1
                  },
                  "pendingMessages": [
                    {
                      "id": "pending-1",
                      "sessionId": "session-1",
                      "clientPendingId": "optimistic-native-1",
                      "content": "follow up",
                      "createdAt": 1783015200700,
                      "updatedAt": 1783015200701,
                      "mode": "queued",
                      "sequence": 1
                    }
                  ],
                  "message": {
                    "role": "assistant",
                    "content": "Message queued for the next turn."
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(response.queued, true)
        XCTAssertEqual(response.pendingMessage?.content, "follow up")
        XCTAssertEqual(response.pendingMessage?.clientPendingId, "optimistic-native-1")
        XCTAssertEqual(response.pendingMessages.first?.mode, "queued")
        XCTAssertEqual(response.pendingMessages.first?.clientPendingId, "optimistic-native-1")
    }

    func testChatSendResponsePreservesAssistantToolTimelineMetadata() throws {
        let response = try JSONDecoder().decode(
            ChatSendResponse.self,
            from: Data(
                #"""
                {
                  "sessionId": "session-1",
                  "message": {
                    "role": "assistant",
                    "content": "Done.",
                    "timestamp": "2026-07-02T18:00:00.000Z",
                    "process_activities": [
                      {
                        "id": "activity-1",
                        "phase": "result",
                        "text": "Ran tests",
                        "timestamp": 1783015200500,
                        "toolName": "exec_command",
                        "toolCallId": "tool-1"
                      }
                    ],
                    "tool_calls": [
                      {
                        "id": "tool-1",
                        "name": "exec_command",
                        "status": "completed",
                        "arguments": {"cmd": "bun test tests/api/sessions-pagination.test.ts"}
                      }
                    ]
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(response.message?.timestamp, "2026-07-02T18:00:00.000Z")
        XCTAssertEqual(response.message?.process_activities?.first?.text, "Ran tests")
        XCTAssertEqual(response.message?.tool_calls?.first?.args?["cmd"]?.displayString, "bun test tests/api/sessions-pagination.test.ts")
    }

    func testSessionWorkspaceUpdateResponseDecodesGatewayError() throws {
        let response = try JSONDecoder().decode(
            GatewaySessionWorkspaceUpdateResponse.self,
            from: Data(#"{"success":false,"error":"Cannot update workspace for subagent sessions"}"#.utf8)
        )

        XCTAssertEqual(response.success, false)
        XCTAssertEqual(response.error, "Cannot update workspace for subagent sessions")
    }

    func testMemoryListDecodesFilesAndEntries() throws {
        let list = try JSONDecoder().decode(
            GatewayMemoryList.self,
            from: Data(
                #"""
                {
                  "files": ["project notes.md"],
                  "memories": [
                    {
                      "file": "project notes.md",
                      "entries": [
                        {
                          "timestamp": "2026-07-02T18:00:00.000Z",
                          "type": "note",
                          "content": "remember this"
                        }
                      ]
                    }
                  ]
                }
                """#.utf8
            )
        )

        XCTAssertEqual(list.files, ["project notes.md"])
        XCTAssertEqual(list.memories.first?.file, "project notes.md")
        XCTAssertEqual(list.memories.first?.entries.first?.timestamp, "2026-07-02T18:00:00.000Z")
        XCTAssertEqual(list.memories.first?.entries.first?.content, "remember this")
    }

    func testMemorySearchResponseDecodesGatewayResults() throws {
        let response = try JSONDecoder().decode(
            GatewayMemorySearchResponse.self,
            from: Data(
                #"""
                {
                  "results": [
                    {
                      "file": "project notes.md",
                      "entry": {"content": "remember this"}
                    }
                  ]
                }
                """#.utf8
            )
        )

        XCTAssertEqual(response.results.first?.file, "project notes.md")
        XCTAssertEqual(response.results.first?.entry.content, "remember this")
    }

    func testMemoryCreateResponseDecodesGatewaySuccessShape() throws {
        let response = try JSONDecoder().decode(
            GatewayMemoryCreateResponse.self,
            from: Data(#"{"success":true,"file":"project notes.md","appended":true}"#.utf8)
        )

        XCTAssertTrue(response.success)
        XCTAssertEqual(response.file, "project notes.md")
        XCTAssertEqual(response.appended, true)
    }

    func testSessionProviderModelSummaryFormatsProviderType() throws {
        let session = try decodeSession(
            #"{"id":"session-1","provider":"openrouter","model":"anthropic/claude-sonnet-4","agent_type":"main"}"#
        )

        XCTAssertEqual(
            session.providerModelAndAgentSummary,
            "OpenRouter · anthropic/claude-sonnet-4 · via Main"
        )
    }

    func testProviderDisplayNamePrefersFirstNonEmptyGatewayLabel() throws {
        let named = try decodeProvider(
            #"{"id":"openai","name":"  OpenAI  ","provider":"openai","enabled":true}"#)
        let providerFallback = try decodeProvider(
            #"{"id":"anthropic-id","name":"   ","provider":" Anthropic ","enabled":true}"#)
        let idFallback = try decodeProvider(#"{"id":"local","name":" ","provider":"\n"}"#)

        XCTAssertEqual(named.displayName, "OpenAI")
        XCTAssertEqual(providerFallback.displayName, "Anthropic")
        XCTAssertEqual(idFallback.displayName, "local")
    }

    func testTaskDecodesConfigBackedEditableFields() throws {
        let task = try decodeTask(
            #"""
            {
              "id": "task-1",
              "name": "Daily summary",
              "schedule": "0 9 * * 1",
              "status": "pending",
              "agentId": "agent-1",
              "sessionId": "chat-1",
              "enabled": true,
              "lastRun": "2026-07-02T12:00:00.000Z",
              "nextRun": "2026-07-06T09:00:00.000Z",
              "config": {
                "action": "Summarize workspace changes",
                "description": "Weekly release prep"
              }
            }
            """#
        )

        XCTAssertEqual(task.agent_id, "agent-1")
        XCTAssertEqual(task.session_id, "chat-1")
        XCTAssertTrue(task.isRunning)
        XCTAssertEqual(task.statusLabel, "Active")
        XCTAssertEqual(task.action, "Summarize workspace changes")
        XCTAssertEqual(task.description, "Weekly release prep")
        XCTAssertEqual(task.last_run, "2026-07-02T12:00:00.000Z")
        XCTAssertEqual(task.next_run, "2026-07-06T09:00:00.000Z")
    }

    func testTaskRunDecodesCamelCaseGatewayPayload() throws {
        let run = try JSONDecoder().decode(
            GatewayTaskRun.self,
            from: Data(
                #"""
                {
                  "id": "run-1",
                  "taskId": "task-1",
                  "status": "completed",
                  "startedAt": "2026-07-02T12:00:00.000Z",
                  "completedAt": "2026-07-02T12:00:03.000Z",
                  "sessionId": "task:task-1:1",
                  "resultPreview": "Done"
                }
                """#.utf8
            )
        )

        XCTAssertEqual(run.task_id, "task-1")
        XCTAssertEqual(run.started_at, "2026-07-02T12:00:00.000Z")
        XCTAssertEqual(run.completed_at, "2026-07-02T12:00:03.000Z")
        XCTAssertEqual(run.session_id, "task:task-1:1")
        XCTAssertEqual(run.result_preview, "Done")
    }

    func testAgentDecodesEditableConfigFields() throws {
        let agent = try JSONDecoder().decode(
            GatewayAgent.self,
            from: Data(
                #"""
                {
                  "id": "agent-1",
                  "name": "Research",
                  "type": "research",
                  "model": "gpt-4.1",
                  "status": "running",
                  "provider_id": "provider-1",
                  "system_prompt": "Be useful.",
                  "config": {
                    "autostart": true,
                    "model_params": {
                      "reasoning_effort": "high"
                    }
                  }
                }
                """#.utf8
            )
        )

        XCTAssertTrue(agent.isRunning)
        XCTAssertEqual(agent.providerID, "provider-1")
        XCTAssertTrue(agent.autostart)
        XCTAssertEqual(agent.reasoningEffort, "high")
    }

    func testAgentDecodesGatewayListRowWithPersistedJsonConfigString() throws {
        let agent = try JSONDecoder().decode(
            GatewayAgent.self,
            from: Data(
                #"""
                {
                  "id": "agent-sqlite",
                  "name": "SQLite Agent",
                  "type": "main",
                  "model": "gpt-5-mini",
                  "provider": "provider-1",
                  "provider_id": "provider-1",
                  "provider_type": "openai-codex",
                  "system_prompt": "Use tools carefully.",
                  "config": "{\"autostart\":true,\"model_params\":{\"reasoning_effort\":\"medium\"}}",
                  "status": "stopped",
                  "memory_enabled": 1,
                  "created_at": "2026-07-02 18:00:00"
                }
                """#.utf8
            )
        )

        XCTAssertEqual(agent.id, "agent-sqlite")
        XCTAssertEqual(agent.providerID, "provider-1")
        XCTAssertEqual(agent.providerType, "openai-codex")
        XCTAssertTrue(agent.autostart)
        XCTAssertEqual(agent.reasoningEffort, "medium")
    }

    func testAgentDecodesLightweightSummaryReasoningEffort() throws {
        let agent = try decodeAgent(
            #"{"id":"agent-summary","name":"Summary","model":"gpt-5.6-sol","provider_type":"openai-codex","reasoning_effort":"xhigh","supports_images":true}"#
        )

        XCTAssertEqual(agent.providerType, "openai-codex")
        XCTAssertEqual(agent.reasoningEffort, "xhigh")
        XCTAssertTrue(agent.supportsImages)
        XCTAssertNil(agent.config)
    }

    func testProviderModelsDecodeAvailableProviderCatalog() throws {
        let available = try JSONDecoder().decode(
            GatewayAvailableProvider.self,
            from: Data(
                #"""
                {
                  "id": "openai",
                  "name": "OpenAI",
                  "description": "Use OpenAI models",
                  "baseUrl": "https://api.openai.com/v1",
                  "authType": "oauth",
                  "oauthFlow": "redirect",
                  "hasOAuthConfig": true,
                  "oauthLoginUrl": "https://chatgpt.com/",
                  "models": [
                    {"id": "gpt-4.1", "name": "GPT-4.1", "context": 1048576, "reasoning": true}
                  ]
                }
                """#.utf8
            )
        )
        let cached = try JSONDecoder().decode(
            GatewayProviderModel.self,
            from: Data(#"{"model_id":"gpt-4.1","model_name":"GPT-4.1","context_window":1048576}"#.utf8)
        )

        XCTAssertEqual(available.models.first?.id, "gpt-4.1")
        XCTAssertEqual(available.authType, "oauth")
        XCTAssertEqual(available.oauthFlow, "redirect")
        XCTAssertEqual(available.hasOAuthConfig, true)
        XCTAssertEqual(available.oauthLoginUrl, "https://chatgpt.com/")
        XCTAssertEqual(cached.displayName, "GPT-4.1")
    }

    func testProviderDecodesGatewayListRowWithSqliteBooleansAndCatalogInfo() throws {
        let provider = try decodeProvider(
            #"""
            {
              "id": "provider-1",
              "provider": "openai",
              "name": "OpenAI",
              "base_url": "https://api.openai.com/v1",
              "is_default": 1,
              "enabled": "true",
              "info": {
                "authType": "oauth",
                "oauthFlow": "redirect",
                "oauthConfig": {"callbackPort": 1455},
                "oauthLoginUrl": "https://chatgpt.com/",
                "models": [
                  {"id": "gpt-5-mini", "name": "GPT-5 Mini"},
                  {"model_id": "gpt-5.1-codex", "model_name": "GPT-5.1 Codex"}
                ]
              }
            }
            """#
        )

        XCTAssertEqual(provider.id, "provider-1")
        XCTAssertEqual(provider.providerType, "openai")
        XCTAssertEqual(provider.is_default, true)
        XCTAssertEqual(provider.enabled, true)
        XCTAssertEqual(provider.models, ["gpt-5-mini", "gpt-5.1-codex"])
        XCTAssertEqual(provider.authType, "oauth")
        XCTAssertEqual(provider.oauthFlow, "redirect")
        XCTAssertEqual(provider.hasOAuthConfig, true)
        XCTAssertEqual(provider.oauthLoginUrl, "https://chatgpt.com/")
    }

    func testProviderModelDecodesGatewayModelCacheRows() throws {
        let model = try JSONDecoder().decode(
            GatewayProviderModel.self,
            from: Data(
                #"""
                {
                  "id": "model-row-1",
                  "model_id": "gpt-5-mini",
                  "model_name": "GPT-5 Mini",
                  "context_window": 200000,
                  "max_tokens": 32768,
                  "reasoning": 0,
                  "input_types": "[\"text\"]"
                }
                """#.utf8
            )
        )

        XCTAssertEqual(model.id, "gpt-5-mini")
        XCTAssertEqual(model.displayName, "GPT-5 Mini")
        XCTAssertEqual(model.context_window, 200000)
        XCTAssertEqual(model.reasoning, false)
    }

    func testGatewayTimestampsFormatSQLiteAndIsoValues() {
        XCTAssertFalse(relativeTimestamp("2026-07-02 18:00:00").isEmpty)
        XCTAssertFalse(absoluteTimestamp("2026-07-02T18:00:00Z").isEmpty)
    }

    func testSessionMessageDecodesToolCallsAndProcessActivities() throws {
        let message = try decodeSessionMessage(
            #"""
            {
              "role": "assistant",
              "content": "Done.",
              "timestamp": "2026-07-02T18:00:00.000Z",
              "thinking": "Checked the workspace first.",
              "tool_calls": [
                {
                  "id": "tool-read",
                  "name": "read",
                  "timeline_index": 2,
                  "args": {"path": "/tmp/GatewayModels.swift", "offset": 20, "limit": 3},
                  "status": "completed",
                  "result": {"sandbox_provider": "host"}
                },
                {
                  "id": "tool-exec",
                  "name": "exec_command",
                  "timeline_index": 1,
                  "arguments": {"cmd": "bun test tests/runtime/native-macos-shell-wiring.test.ts"},
                  "status": "completed",
                  "duration": "1500",
                  "result": {"sandboxProvider": "host"}
                }
              ],
              "process_activities": [
                {
                  "id": "activity-1",
                  "phase": "start",
                  "text": "Running model checks",
                  "timestamp": "2026-07-02T18:00:00.500Z",
                  "tool_name": "exec_command",
                  "tool_call_id": "tool-exec",
                  "sandbox_provider": "host"
                }
              ],
              "agent_transfers": [
                {
                  "protocol": "cybara-agent-transfer-v1",
                  "status": "accepted",
                  "sessionId": "session-1",
                  "fromAgentId": "agent-a",
                  "fromAgentName": "Builder",
                  "toAgentId": "agent-b",
                  "toAgentName": "Reviewer",
                  "reason": "Review the completed implementation",
                  "contextMode": "recent",
                  "contextSummary": "Implementation and tests are complete",
                  "requestedAt": "2026-07-02T18:00:01.000Z"
                }
              ],
              "_tool_calls_total_count": 2,
              "_tool_calls_hidden_count": 0
            }
            """#
        )

        XCTAssertEqual(message.tool_calls?.count, 2)
        XCTAssertEqual(message.tool_calls?.first?.args?["path"]?.displayString, "/tmp/GatewayModels.swift")
        XCTAssertEqual(message.tool_calls?[1].args?["cmd"]?.displayString, "bun test tests/runtime/native-macos-shell-wiring.test.ts")
        XCTAssertEqual(nativeOrderedToolCalls(message.tool_calls).map(\.id), ["tool-exec", "tool-read"])
        XCTAssertEqual(message.process_activities?.first?.toolName, "exec_command")
        XCTAssertEqual(message.process_activities?.first?.toolCallId, "tool-exec")
        XCTAssertEqual(message.process_activities?.first?.sandboxProvider, "host")
        XCTAssertEqual(message.agent_transfers?.first?.fromAgentName, "Builder")
        XCTAssertEqual(message.agent_transfers?.first?.toAgentName, "Reviewer")
        XCTAssertEqual(message.agent_transfers?.first?.contextMode, "recent")
        XCTAssertGreaterThan(message.process_activities?.first?.timestamp ?? 0, 1_783_000_000_000)
    }

    func testAssistantSessionMessageDecodingStripsReasoningMarkup() throws {
        let message = try decodeSessionMessage(
            #"""
            {
              "role": "assistant",
              "content": "<think>Inspect native chat formatting.</think>\n<final>The rendered reply.</final>",
              "timestamp": "2026-07-02T18:00:00.000Z"
            }
            """#
        )
        let userMessage = try decodeSessionMessage(
            #"""
            {
              "role": "user",
              "content": "What does </think> mean?",
              "timestamp": "2026-07-02T18:01:00.000Z"
            }
            """#
        )

        XCTAssertEqual(message.content, "The rendered reply.")
        XCTAssertEqual(message.thinking, "Inspect native chat formatting.")
        XCTAssertEqual(userMessage.content, "What does </think> mean?")
    }

    func testNativeToolTimelineUsesProcessActivitiesWhenPresent() throws {
        let message = try decodeSessionMessage(
            #"""
            {
              "role": "assistant",
              "content": "Done.",
              "timestamp": "2026-07-02T18:00:00.000Z",
              "tool_calls": [
                {
                  "id": "tool-exec",
                  "name": "exec_command",
                  "timeline_index": 1,
                  "args": {"cmd": "bun test"},
                  "status": "completed"
                }
              ],
              "process_activities": [
                {
                  "id": "activity-1",
                  "phase": "start",
                  "text": "Running model checks",
                  "timestamp": 1783015200500,
                  "toolName": "exec_command",
                  "toolCallId": "tool-exec"
                }
              ]
            }
            """#
        )

        let activities = nativeToolActivities(for: message)

        XCTAssertEqual(activities.map(\.text), ["Ran model checks"])
        XCTAssertEqual(activities.first?.phase, .result)
        XCTAssertEqual(activities.first?.toolCallId, "tool-exec")
    }

    func testNativeToolTimelineHidesProviderRecoveryStatus() {
        XCTAssertTrue(nativeIsGenericStatusLabel("Provider rate limited; retrying (2/5)..."))
        XCTAssertTrue(nativeIsGenericStatusLabel("Provider session refreshed; continuing..."))
        XCTAssertTrue(nativeIsGenericStatusLabel("Thinking..."))
        XCTAssertTrue(nativeIsGenericStatusLabel("Generating response..."))
        XCTAssertTrue(nativeIsGenericStatusLabel("Working..."))
        XCTAssertFalse(nativeIsGenericStatusLabel("Provider rate limit hit (429)."))
    }

    func testNativeToolTimelineFallsBackToToolCallsInTimelineOrder() throws {
        let message = try decodeSessionMessage(
            #"""
            {
              "role": "assistant",
              "content": "Done.",
              "timestamp": "2026-07-02T18:00:00.000Z",
              "tool_calls": [
                {
                  "id": "tool-read",
                  "name": "read",
                  "timeline_index": 2,
                  "started_at": 2000,
                  "args": {"path": "/tmp/GatewayModels.swift", "offset": 20, "limit": 3},
                  "status": "completed"
                },
                {
                  "id": "tool-exec",
                  "name": "exec_command",
                  "timeline_index": 1,
                  "started_at": 1000,
                  "arguments": {"cmd": "bun test tests/runtime/native-macos-shell-wiring.test.ts"},
                  "status": "completed",
                  "duration": 1500,
                  "result": {"sandboxProvider": "host"}
                }
              ]
            }
            """#
        )

        let ordered = nativeOrderedToolCalls(message.tool_calls)
        let activities = nativeToolActivities(for: message)

        XCTAssertEqual(ordered.map(\.id), ["tool-exec", "tool-read"])
        XCTAssertEqual(activities.map(\.text), [
            "Ran bun test tests/runtime/native-macos-shell-wiring.test.ts",
            "Explored GatewayModels.swift (lines 20-22)",
        ])
        XCTAssertEqual(activities.first?.sandboxProvider, "host")
        XCTAssertEqual(nativeWorkedDurationLabel(for: message), "0h 00m 01s")
    }

    func testNativeGroupActivitiesKeepsThoughtsBetweenCommandGroups() {
        let entries = nativeGroupActivities([
            NativeToolActivity(
                id: "a",
                phase: .result,
                text: "Ran ls -la",
                timestamp: 1,
                toolName: "exec",
                toolCallId: nil,
                sandboxProvider: nil
            ),
            NativeToolActivity(
                id: "b",
                phase: .result,
                text: "Explored 53 files, 1 search",
                timestamp: 2,
                toolName: "grep",
                toolCallId: nil,
                sandboxProvider: nil
            ),
            NativeToolActivity(
                id: "t",
                phase: .result,
                text: "Now checking the package metadata",
                timestamp: 3,
                toolName: "__thought",
                toolCallId: nil,
                sandboxProvider: nil
            ),
            NativeToolActivity(
                id: "c",
                phase: .result,
                text: "Ran cd /repo && wc -l package.json",
                timestamp: 4,
                toolName: "exec",
                toolCallId: nil,
                sandboxProvider: nil
            ),
            NativeToolActivity(
                id: "d",
                phase: .result,
                text: "Ran git log --oneline",
                timestamp: 5,
                toolName: "exec",
                toolCallId: nil,
                sandboxProvider: nil
            ),
        ])

        XCTAssertEqual(entries.count, 3)
        if case .group(_, let label, let items) = entries[0] {
            XCTAssertEqual(label, "Listed a location, ran a search")
            XCTAssertEqual(items.map(\.id), ["a", "b"])
        } else {
            XCTFail("expected first command group")
        }
        if case .single(let thought) = entries[1] {
            XCTAssertEqual(thought.toolName, "__thought")
        } else {
            XCTFail("expected visible thought")
        }
        if case .group(_, let label, let items) = entries[2] {
            XCTAssertEqual(label, "Ran 2 commands")
            XCTAssertEqual(items.map(\.id), ["c", "d"])
        } else {
            XCTFail("expected second command group")
        }
    }

    func testNativeBrowserActivityRequiresActiveInFlightTool() {
        let start = NativeToolActivity(
            id: "browser-start",
            phase: .start,
            text: "Opening browser",
            timestamp: 1,
            toolName: "browser",
            toolCallId: "browser-1",
            sandboxProvider: nil
        )
        let result = NativeToolActivity(
            id: "browser-result",
            phase: .result,
            text: "Opened browser",
            timestamp: 2,
            toolName: "browser",
            toolCallId: "browser-1",
            sandboxProvider: nil
        )

        XCTAssertTrue(nativeAgentUsingBrowser([start], sessionActive: true))
        XCTAssertFalse(nativeAgentUsingBrowser([start], sessionActive: false))
        XCTAssertFalse(nativeAgentUsingBrowser([result], sessionActive: true))
    }

    func testNativeLongRunningToolCompletionKeepsStartPosition() {
        let baseTimestamp = 1_783_700_000_000.0
        let existing = [
            NativeToolActivity(
                id: "long-command",
                phase: .start,
                text: "Running repository tests",
                timestamp: baseTimestamp,
                toolName: "exec",
                toolCallId: "long-command",
                sandboxProvider: nil
            ),
            NativeToolActivity(
                id: "later-thought",
                phase: .result,
                text: "Reviewing another issue",
                timestamp: baseTimestamp + 1,
                toolName: "__thought",
                toolCallId: nil,
                sandboxProvider: nil
            ),
        ]
        let completed = nativeMergeLiveActivity(
            existing,
            incoming: NativeToolActivity(
                id: "long-command-result",
                phase: .result,
                text: "Ran repository tests",
                timestamp: baseTimestamp + 25 * 60_000,
                toolName: "exec",
                toolCallId: "long-command",
                sandboxProvider: nil
            )
        )

        XCTAssertEqual(completed.map(\.text), ["Ran repository tests", "Reviewing another issue"])
        XCTAssertEqual(completed.first?.timestamp, baseTimestamp)
        XCTAssertFalse(completed.contains(where: { $0.phase == .start }))
    }
}
