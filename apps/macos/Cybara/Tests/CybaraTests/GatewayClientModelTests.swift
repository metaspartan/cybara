import XCTest

@testable import Cybara

final class GatewayClientModelTests: XCTestCase {

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
            XCTAssertEqual(label, "Ran 2 commands")
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

    func testNativeCompactingStatusRendersVisibleThoughtActivity() throws {
        let event = try decodeStatusEvent(
            #"""
            {
              "type": "status",
              "status": "compacting",
              "timestamp": 1783015200100,
              "sessionId": "session-1"
            }
            """#
        )

        let activity = nativeLiveActivity(from: event)
        XCTAssertEqual(activity?.toolName, "__thought")
        XCTAssertEqual(activity?.phase, .result)
        XCTAssertEqual(activity?.text, "Context automatically compacted")
    }

    func testNativeStatusEventsDecodeLiveToolActivityAndSnapshots() throws {
        let status = try decodeStatusEvent(
            #"""
            {
              "type": "status",
              "status": "tool_executing",
              "timestamp": 1783015200500,
              "sessionId": "session-1",
              "agentId": "agent-1",
              "detail": "Running bun test",
              "toolName": "exec_command",
              "toolCallId": "tool-1",
              "sandboxProvider": "host"
            }
            """#
        )
        let snapshot = try decodeStatusEvent(
            #"""
            {
              "type": "snapshot",
              "timestamp": 1783015200600,
              "activeSessionIds": ["session-1"],
              "activeSessions": [
                {
                  "sessionId": "session-1",
                  "status": "tool_executing",
                  "timestamp": 1783015200600,
                  "detail": "Running bun test",
                  "pendingMessages": [
                    {
                      "id": "pending-1",
                      "sessionId": "session-1",
                      "content": "steer this",
                      "createdAt": 1783015200700,
                      "updatedAt": 1783015200701,
                      "mode": "steering",
                      "sequence": 1
                    }
                  ],
                  "activities": [
                    {
                      "id": "activity-1",
                      "phase": "start",
                      "text": "Running bun test",
                      "timestamp": 1783015200500,
                      "toolName": "exec_command",
                      "toolCallId": "tool-1",
                      "sandboxProvider": "host"
                    }
                  ]
                }
              ]
            }
            """#
        )

        XCTAssertEqual(status.toolName, "exec_command")
        XCTAssertEqual(status.toolCallId, "tool-1")
        XCTAssertEqual(status.sandboxProvider, "host")
        let liveActivity = try XCTUnwrap(nativeLiveActivity(from: status))
        XCTAssertEqual(liveActivity.phase, .start)
        XCTAssertEqual(liveActivity.text, "Running bun test")
        XCTAssertEqual(liveActivity.sandboxProvider, "host")
        XCTAssertEqual(snapshot.activeSessionIds, ["session-1"])
        XCTAssertEqual(snapshot.activeSessions[0].pendingMessages.first?.content, "steer this")
        XCTAssertEqual(snapshot.activeSessions[0].pendingMessages.first?.mode, "steering")
        XCTAssertEqual(nativeLiveActivities(from: snapshot.activeSessions[0]).first?.phase, .start)
    }

    func testNativeSteeringPayloadsKeepWorkAndDropHandoffRows() throws {
        let payloads = nativeSteeringProcessActivityPayloads(from: [
            NativeToolActivity(
                id: "activity-1",
                phase: .result,
                text: "Ran repo review before steering",
                timestamp: 1_783_015_200_500,
                toolName: "exec_command",
                toolCallId: "tool-1",
                sandboxProvider: "host"
            ),
            NativeToolActivity(
                id: "handoff",
                phase: .result,
                text: "Steering to follow-up...",
                timestamp: 1_783_015_200_600,
                toolName: "__thought",
                toolCallId: nil,
                sandboxProvider: nil
            ),
        ])

        XCTAssertEqual(payloads.count, 1)
        XCTAssertEqual(payloads.first?.text, "Ran repo review before steering")
        XCTAssertEqual(payloads.first?.toolCallId, "tool-1")

        let data = try JSONEncoder().encode(["processActivities": payloads])
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let activities = object?["processActivities"] as? [[String: Any]]
        XCTAssertEqual(activities?.first?["toolName"] as? String, "exec_command")
        XCTAssertEqual(activities?.first?["sandboxProvider"] as? String, "host")
    }

    func testPendingChatResponseDecodesInterruptedMessage() throws {
        let response = try JSONDecoder().decode(
            GatewayPendingChatResponse.self,
            from: Data(
                #"""
                {
                  "success": true,
                  "pendingMessages": [],
                  "interruptedMessage": {
                    "role": "assistant",
                    "content": "",
                    "process_activities": [
                      {
                        "id": "activity-1",
                        "phase": "result",
                        "text": "Ran repo review before steering",
                        "timestamp": 1783015200500,
                        "toolName": "exec_command",
                        "toolCallId": "tool-1"
                      }
                    ]
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(response.success, true)
        XCTAssertEqual(response.interruptedMessage?.process_activities?.first?.text, "Ran repo review before steering")
        XCTAssertEqual(response.interruptedMessage?.process_activities?.first?.toolCallId, "tool-1")
    }

    func testNativeStatusEventsDecodeScopedSessionStatusResponse() throws {
        let status = try decodeStatusEvent(
            #"""
            {
              "sessionId": "session-1",
              "active": true,
              "activeSessionIds": ["session-1"],
              "session": {
                "sessionId": "session-1",
                "status": "tool_executing",
                "timestamp": 1783015200600,
                "detail": "Running bun test",
                "activities": [
                  {
                    "id": "activity-1",
                    "phase": "start",
                    "text": "Running bun test",
                    "timestamp": 1783015200500,
                    "toolName": "exec_command",
                    "toolCallId": "tool-1"
                  }
                ]
              }
            }
            """#
        )

        XCTAssertEqual(status.sessionId, "session-1")
        XCTAssertEqual(status.active, true)
        XCTAssertEqual(status.session?.sessionId, "session-1")
        XCTAssertEqual(status.session?.activities.first?.text, "Running bun test")
    }

    func testChannelDisplayNamePrefersFirstNonEmptyGatewayLabel() throws {
        let named = try decodeChannel(#"{"id":"telegram-1","name":"  Telegram Ops  ","type":"telegram"}"#)
        let typeFallback = try decodeChannel(#"{"id":"slack-1","name":" ","type":" Slack "}"#)
        let idFallback = try decodeChannel(#"{"id":"webhook-1","name":" ","type":""}"#)

        XCTAssertEqual(named.displayName, "Telegram Ops")
        XCTAssertEqual(typeFallback.displayName, "Slack")
        XCTAssertEqual(idFallback.displayName, "webhook-1")
    }

    func testChannelDecodesDefaultAgentAssignment() throws {
        let assigned = try decodeChannel(
            #"{"id":"telegram-1","type":"telegram","config":{"agent_id":"agent-2","use_model_router":true}}"#
        )
        let inherited = try decodeChannel(
            #"{"id":"telegram-2","type":"telegram","config":{"agent_id":null}}"#
        )

        XCTAssertEqual(assigned.agentID, "agent-2")
        XCTAssertTrue(assigned.usesModelRouter)
        XCTAssertNil(inherited.agentID)
        XCTAssertFalse(inherited.usesModelRouter)
    }

    func testGatewayLogPageDecodesBoundedCombinedLogs() throws {
        let page = try JSONDecoder().decode(
            GatewayLogPage.self,
            from: Data(
                #"""
                {
                  "logs": [
                    {
                      "id": "log-1",
                      "level": "info",
                      "source": "agent",
                      "message": "Agent completed task",
                      "metadata": "{\"sessionId\":\"session-1\"}",
                      "created_at": "2026-07-03T04:12:18Z",
                      "logType": "agent"
                    }
                  ],
                  "total": 38733,
                  "limit": 200,
                  "offset": 0,
                  "hasMore": true
                }
                """#.utf8
            )
        )

        XCTAssertEqual(page.logs.first?.id, "log-1")
        XCTAssertEqual(page.logs.first?.metadata, #"{"sessionId":"session-1"}"#)
        XCTAssertEqual(page.logs.first?.logType, "agent")
        XCTAssertEqual(page.total, 38733)
        XCTAssertEqual(page.limit, 200)
        XCTAssertTrue(page.hasMore == true)
    }

    func testMobileDeviceModelsExposeStatusAndScopes() throws {
        let device = try JSONDecoder().decode(
            GatewayMobileDevice.self,
            from: Data(
                #"""
                {
                  "id": "mobile_123",
                  "name": "Carsen iPhone",
                  "baseUrl": "http://192.168.1.20:4269",
                  "status": "active",
                  "scopes": ["chat", "manage", "read"],
                  "createdAt": "2026-07-02T18:00:00.000Z",
                  "push": {
                    "configured": true,
                    "enabled": true,
                    "provider": "expo",
                    "platform": "ios",
                    "updatedAt": "2026-07-02T18:01:00.000Z"
                  }
                }
                """#.utf8
            )
        )

        XCTAssertTrue(device.isActive)
        XCTAssertEqual(device.scopeSummary, "chat, manage, read")
        XCTAssertEqual(device.pushSummary, "Push: expo · ios · chat on · tasks on")

        let deviceWithPrefs = try JSONDecoder().decode(
            GatewayMobileDevice.self,
            from: Data(
                #"""
                {
                  "id": "mobile_456",
                  "name": "Carsen iPad",
                  "baseUrl": "http://192.168.1.20:4269",
                  "status": "active",
                  "scopes": ["chat"],
                  "createdAt": "2026-07-02T18:00:00.000Z",
                  "push": {
                    "configured": true,
                    "enabled": true,
                    "provider": "expo",
                    "platform": "android",
                    "preferences": { "chatCompletions": false, "taskCompletions": true }
                  }
                }
                """#.utf8
            )
        )
        XCTAssertEqual(deviceWithPrefs.pushSummary, "Push: expo · android · chat off · tasks on")
    }

    func testMobilePairingCodeDecodesExpiryAndPayload() throws {
        let pairing = try JSONDecoder().decode(
            GatewayMobilePairingCode.self,
            from: Data(
                #"""
                {
                  "success": true,
                  "code": "ABCD-2345",
                  "expiresAt": 1783015200000,
                  "encoded": "{\"protocol\":\"cybara-mobile-pair-v1\"}",
                  "qrDataUrl": "data:image/png;base64,abcd",
                  "payload": {
                    "protocol": "cybara-mobile-pair-v1",
                    "name": "Studio Gateway",
                    "baseUrl": "http://192.168.1.20:4269",
                    "code": "ABCD-2345",
                    "role": "standard",
                    "expiresAt": 1783015200000
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(pairing.payload.protocol, "cybara-mobile-pair-v1")
        XCTAssertEqual(pairing.payload.role, "standard")
        XCTAssertEqual(pairing.expiresAtDate?.timeIntervalSince1970, 1783015200)
    }

    func testMobileConnectInfoDecodesGatewayReachability() throws {
        let info = try JSONDecoder().decode(
            GatewayMobileConnectInfo.self,
            from: Data(
                #"""
                {
                  "baseUrl": "http://192.168.1.20:4269",
                  "lanAccessEnabled": true,
                  "candidates": ["http://192.168.1.20:4269", "http://10.0.0.4:4269"],
                  "warnings": ["Remote access requires a gateway password."],
                  "remoteAccess": {
                    "enabled": true,
                    "ready": false,
                    "mode": "cloudflared",
                    "provider": "Cloudflare Tunnel",
                    "baseUrl": null,
                    "message": "Tunnel not ready"
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(info.baseUrl, "http://192.168.1.20:4269")
        XCTAssertTrue(info.lanAccessEnabled)
        XCTAssertEqual(info.candidates.count, 2)
        XCTAssertEqual(info.remoteAccess?.provider, "Cloudflare Tunnel")
        XCTAssertEqual(info.remoteAccess?.ready, false)
    }

    func testMetricsOverviewDecodesFullGatewayPayload() throws {
        let overview = try JSONDecoder().decode(
            MetricsOverview.self,
            from: Data(
                #"""
                {
                  "tokenUsage": {"total": 1200, "input": 700, "output": 400, "cache": 100},
                  "fileOperations": {"filesRead": 9, "filesWritten": 3, "filesEdited": 2, "filesSearched": 4},
                  "toolCalls": {"totalCalls": 18},
                  "apiCalls": {"totalCalls": 20, "successfulCalls": 18, "failedCalls": 2},
                  "agentActivity": {"totalExecutions": 8, "totalMessages": 6},
                  "sessions": {
                    "totalSessions": 4,
                    "memoryFlushes": 2,
                    "memoryFlushFailures": 1,
                    "compactions": 3
                  },
                  "contextHealth": {"warnings": 5, "criticalWarnings": 1}
                }
                """#.utf8
            )
        )

        XCTAssertEqual(overview.tokenUsage?.total, 1200)
        XCTAssertEqual(overview.fileOperations?.filesSearched, 4)
        XCTAssertEqual(overview.apiCalls?.successRate, 90)
        XCTAssertEqual(overview.sessions?.memoryFlushFailures, 1)
        XCTAssertEqual(overview.contextHealth?.criticalWarnings, 1)
    }

    func testMetricsModelsDecodeDynamicSeriesAndStorage() throws {
        let series = try JSONDecoder().decode(
            TimeSeriesData.self,
            from: Data(
                #"""
                {
                  "days": [
                    {"date": "2026-07-01", "token_usage": 42, "tool_call": 8, "activity": "3"}
                  ]
                }
                """#.utf8
            )
        )
        let storage = try JSONDecoder().decode(
            MetricsStorage.self,
            from: Data(
                #"""
                {
                  "totalBytes": 4096,
                  "accountedBytes": 3072,
                  "uncategorizedBytes": 1024,
                  "directories": {"cybaraDir": "/Users/carsen/.cybara"},
                  "components": {
                    "database": {"path": "/Users/carsen/.cybara/data/cybara.db", "bytes": 2048},
                    "logs": {"path": "/Users/carsen/.cybara/logs", "bytes": 1024},
                    "data": {"path": "/Users/carsen/.cybara/data", "bytes": 2048}
                  },
                  "topLevel": [
                    {"name": "data", "path": "/Users/carsen/.cybara/data", "bytes": 2048, "type": "directory"}
                  ]
                }
                """#.utf8
            )
        )

        XCTAssertEqual(series.days.first?.date, "2026-07-01")
        XCTAssertEqual(series.days.first?.values["token_usage"], 42)
        XCTAssertEqual(series.days.first?.values["activity"], 3)
        XCTAssertEqual(series.days.first?.total, 53)
        XCTAssertEqual(storage.components?.database?.bytes, 2048)
        XCTAssertEqual(storage.topLevel?.first?.name, "data")
    }

    func testRouterStatusDecodesProviderPlanConstraints() throws {
        let status = try JSONDecoder().decode(
            RouterStatusSummary.self,
            from: Data(
                #"""
                {
                  "enabled": true,
                  "strategy": "lowest_cost",
                  "globalSpendToday": 1.25,
                  "totalRequests": 7,
                  "routes": [
                    {
                      "providerId": "openai-codex",
                      "weight": 80,
                      "priority": 1,
                      "enabled": true,
                      "available": false,
                      "reason": "Provider plan exhausted",
                      "requestsIn5hWindow": 3,
                      "requestsInWeekWindow": 12,
                      "spendToday": 1.25,
                      "spendThisWeek": 6.5,
                      "plan": {
                        "monitored": true,
                        "configured": true,
                        "enforced": true,
                        "status": "exhausted",
                        "primaryRemainingPercent": 0
                      }
                    }
                  ]
                }
                """#.utf8
            )
        )

        XCTAssertEqual(status.routes.first?.providerId, "openai-codex")
        XCTAssertEqual(status.routes.first?.plan?.status, "exhausted")
        XCTAssertEqual(status.routes.first?.plan?.enforced, true)
        XCTAssertEqual(status.routes.first?.requestsInWeekWindow, 12)
    }

    func testProviderPlanStatusDecodesUsageWindows() throws {
        let status = try JSONDecoder().decode(
            ProviderPlanStatusResponse.self,
            from: Data(
                #"""
                {
                  "enabled": true,
                  "routerEnforcement": true,
                  "warningThresholdPct": 80,
                  "providers": [
                    {
                      "providerId": "openai-codex",
                      "providerType": "openai-codex",
                      "providerName": "OpenAI Codex",
                      "authType": "oauth",
                      "monitored": true,
                      "appliedPresetId": "openai-codex-plus",
                      "planName": "Codex Plus",
                      "source": "local_metrics_configured_limits",
                      "sourceMode": "local",
                      "sourceLabel": "Local usage with configured limits",
                      "externalSourceAvailable": true,
                      "externalSourceMode": "oauth_api",
                      "externalSourceLabel": "OpenAI OAuth usage",
                      "externalSourceHint": "Use OpenAI OAuth usage APIs.",
                      "status": "warning",
                      "dataConfidence": "local",
                      "updatedAt": "2026-07-06T12:00:00.000Z",
                      "localTokens30d": 1700000,
                      "localSpend30d": 17.25,
                      "presetSuggestions": [
                        {
                          "id": "openai-codex-plus",
                          "label": "ChatGPT Plus",
                          "planName": "Codex Plus",
                          "description": "Moderate local coding sessions.",
                          "confidence": "dynamic",
                          "sourceMode": "oauth_api",
                          "sourceUrl": "https://help.openai.com/",
                          "limitDescription": "Codex uses your ChatGPT agentic allowance.",
                          "externalSourceEnabled": true
                        }
                      ],
                      "windows": [
                        {
                          "id": "monthly",
                          "title": "Billing month",
                          "kind": "billing_month",
                          "usedTokens": 1700000,
                          "tokenLimit": 2000000,
                          "usedSpend": 17.25,
                          "spendLimit": 20,
                          "usedPercent": 85,
                          "remainingPercent": 15,
                          "resetDescription": "Resets Aug 1",
                          "usageKnown": true
                        }
                      ]
                    }
                  ],
                  "summary": {"total": 1, "monitored": 1, "configured": 1, "warnings": 1, "exhausted": 0}
                }
                """#.utf8
            )
        )

        XCTAssertEqual(status.summary.monitored, 1)
        XCTAssertEqual(status.providers.first?.providerName, "OpenAI Codex")
        XCTAssertEqual(status.providers.first?.sourceMode, "local")
        XCTAssertEqual(status.providers.first?.sourceLabel, "Local usage with configured limits")
	        XCTAssertEqual(status.providers.first?.externalSourceAvailable, true)
	        XCTAssertEqual(status.providers.first?.externalSourceLabel, "OpenAI OAuth usage")
	        XCTAssertEqual(status.providers.first?.appliedPresetId, "openai-codex-plus")
	        XCTAssertEqual(status.providers.first?.presetSuggestions.first?.label, "ChatGPT Plus")
	        XCTAssertEqual(status.providers.first?.presetSuggestions.first?.sourceMode, "oauth_api")
	        XCTAssertEqual(status.providers.first?.windows.first?.usedPercent, 85)
        XCTAssertEqual(status.providers.first?.windows.first?.tokenLimit, 2_000_000)
    }

    func testTokenAnalysisMetricsDecodeNativeChartData() throws {
        let analysis = try JSONDecoder().decode(
            TokenAnalysisMetrics.self,
            from: Data(
                #"""
                {
                  "summary": {
                    "callCount": 2,
                    "totalTokens": 900,
                    "totalInputTokens": 500,
                    "totalOutputTokens": 400,
                    "averageTokensPerCall": 450,
                    "medianTokensPerCall": 450,
                    "inputToOutputRatio": 1.25,
                    "outputToInputRatio": 0.8
                  },
                  "promptOutputDistribution": {
                    "sampleCount": 2,
                    "bands": [{"band": "balanced", "calls": 2, "sharePct": 100}]
                  },
                  "tokenHeatmap": {
                    "timezone": "America/Boise",
                    "maxBucketTokens": 700,
                    "hottestHour": {"date": "2026-07-02", "dayLabel": "Thu", "hour": 14, "tokens": 700, "calls": 2},
                    "days": [
                      {
                        "date": "2026-07-02",
                        "dayLabel": "Thu",
                        "hours": [{"hour": 14, "tokens": 700, "calls": 2, "intensity": 1}]
                      }
                    ]
                  },
                  "hourlyVelocity24h": [{"hour": "14:00", "tokens": 700, "calls": 2}],
                  "tokenCloud": [{"token": "gpt-5", "category": "model", "weight": 10, "sharePct": 42}],
                  "modelThoughtProfiles": [
                    {
                      "model": "gpt-5",
                      "provider": "openai",
                      "totalTokens": 900,
                      "calls": 2,
                      "promptSharePct": 55,
                      "responseSharePct": 45,
                      "avgTokensPerCall": 450,
                      "avgLatencyMs": 1200,
                      "avgTps": 40,
                      "behavior": "balanced"
                    }
                  ],
                  "topTokenBursts": [
                    {
                      "timestamp": "2026-07-02T14:00:00.000Z",
                      "model": "gpt-5",
                      "provider": "openai",
                      "inputTokens": 500,
                      "outputTokens": 400,
                      "totalTokens": 900,
                      "durationMs": 1200,
                      "tokensPerSecond": 40
                    }
                  ],
                  "windows": {"analyzedDays": 7, "velocityHours": 24, "newestCallAt": "2026-07-02T14:00:00.000Z", "oldestCallAt": null, "recent24hTokens": 900}
                }
                """#.utf8
            )
        )

        XCTAssertEqual(analysis.summary?.inputToOutputRatio, 1.25)
        XCTAssertEqual(analysis.tokenHeatmap?.hottestHour?.hour, 14)
        XCTAssertEqual(analysis.hourlyVelocity24h.first?.hour, "14:00")
        XCTAssertEqual(analysis.hourlyVelocity24h.first?.calls, 2)
        XCTAssertEqual(analysis.tokenCloud.first?.token, "gpt-5")
        XCTAssertEqual(analysis.modelThoughtProfiles.first?.behavior, "balanced")
        XCTAssertEqual(analysis.topTokenBursts.first?.totalTokens, 900)
    }

    func testCybaraLogoResourceIsBundled() throws {
        XCTAssertNotNil(CybaraBrand.logoImage)
    }

    func testCybaraLogoSearchesPackagedAppResourcesBeforeSwiftPMFallback() throws {
        let appURL = URL(fileURLWithPath: "/Applications/CybaraNative.app", isDirectory: true)
        let resourceURL = appURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Resources", isDirectory: true)
        let executableURL = appURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("MacOS", isDirectory: true)
            .appendingPathComponent("Cybara")

        let candidates = CybaraBrand.logoURLCandidates(
            bundleURL: appURL,
            resourceURL: resourceURL,
            executableURL: executableURL,
            sourceFileURL: nil
        ).map(\.path)

        XCTAssertEqual(
            candidates.first,
            "/Applications/CybaraNative.app/Contents/Resources/Cybara_Cybara.bundle/cybara.png"
        )
        XCTAssertTrue(
            candidates.contains("/Applications/CybaraNative.app/Cybara_Cybara.bundle/cybara.png")
        )
    }

    func testCybaraLogoURLFindsPackagedResourceBundleWithoutBundleModule() throws {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("cybara-logo-resource-\(UUID().uuidString)", isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: temp)
        }

        let appURL = temp.appendingPathComponent("CybaraNative.app", isDirectory: true)
        let resourceBundleURL = appURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Resources", isDirectory: true)
            .appendingPathComponent("Cybara_Cybara.bundle", isDirectory: true)
        let logoURL = resourceBundleURL.appendingPathComponent("cybara.png")
        try FileManager.default.createDirectory(at: resourceBundleURL, withIntermediateDirectories: true)
        try Data([0x89, 0x50, 0x4E, 0x47]).write(to: logoURL)

        XCTAssertEqual(
            CybaraBrand.logoURL(
                bundleURL: appURL,
                resourceURL: appURL
                    .appendingPathComponent("Contents", isDirectory: true)
                    .appendingPathComponent("Resources", isDirectory: true),
                executableURL: appURL
                    .appendingPathComponent("Contents", isDirectory: true)
                    .appendingPathComponent("MacOS", isDirectory: true)
                    .appendingPathComponent("Cybara"),
                sourceFileURL: nil
            )?.path,
            logoURL.path
        )
    }

    func testSkillsStatusDecodesEligibilityAndRequirements() throws {
        let response = try JSONDecoder().decode(
            GatewaySkillsStatusResponse.self,
            from: Data(
                #"""
                {
                  "skills": [
                    {
                      "name": "mactop",
                      "description": "Inspect macOS resource usage",
                      "location": "/Users/carsen/.cybara/skills/mactop/SKILL.md",
                      "source": "local",
                      "eligible": false,
                      "disabled": false,
                      "blockedByAllowlist": false,
                      "requirements": { "bins": ["mactop"], "anyBins": [], "env": [], "anyEnv": [], "config": [], "os": ["darwin"] },
                      "missing": { "bins": ["mactop"], "anyBins": [], "env": ["FAL_KEY"], "anyEnv": [], "config": [], "os": [] },
                      "install": [{ "type": "shell", "command": "brew install mactop" }],
                      "metadata": { "owner": "local" }
                    }
                  ],
                  "summary": { "total": 1, "eligible": 0, "disabled": 0, "blocked": 1 }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(response.summary?.total, 1)
        XCTAssertEqual(response.skills.first?.name, "mactop")
        XCTAssertEqual(response.skills.first?.source, "local")
        XCTAssertEqual(response.skills.first?.requirements.os, ["darwin"])
        XCTAssertEqual(response.skills.first?.missing.bins, ["mactop"])
        XCTAssertEqual(response.skills.first?.missing.env, ["FAL_KEY"])
        XCTAssertEqual(response.skills.first?.install.first?.command, "brew install mactop")
    }

    func testSkillsRegistryAndInstallResponsesDecodeFlexibleFields() throws {
        let registry = try JSONDecoder().decode(
            GatewaySkillsRegistryResponse.self,
            from: Data(
                #"""
                {
                  "skills": [
                    {
                      "slug": "code-review",
                      "name": "Code Review",
                      "description": "Review code changes",
                      "author": "clawhub",
                      "downloads": "1204",
                      "installsCurrent": 44,
                      "installsAllTime": "88",
                      "stars": 12,
                      "version": "1.2.3",
                      "tags": ["review", "security"],
                      "updatedAt": "2026-07-08T10:00:00.000Z",
                      "registry": "clawhub"
                    }
                  ],
                  "registries": ["clawhub"],
                  "counts": { "clawhub": 1 }
                }
                """#.utf8
            )
        )
        let install = try JSONDecoder().decode(
            GatewaySkillInstallResult.self,
            from: Data(
                #"{"success":false,"blockedReason":"suspicious","requiresConfirmation":"true","error":"needs approval","slug":"code-review"}"#.utf8
            )
        )

        XCTAssertEqual(registry.skills.first?.slug, "code-review")
        XCTAssertEqual(registry.skills.first?.downloads, 1204)
        XCTAssertEqual(registry.skills.first?.installsAllTime, 88)
        XCTAssertEqual(registry.skills.first?.tags, ["review", "security"])
        XCTAssertEqual(registry.registries, ["clawhub"])
        XCTAssertEqual(registry.counts["clawhub"], 1)
        XCTAssertFalse(install.success)
        XCTAssertEqual(install.blockedReason, "suspicious")
        XCTAssertEqual(install.requiresConfirmation, true)
    }

    func testNativeSubagentDetailDecodesThoughtsToolsAndOutput() throws {
        let detail = try JSONDecoder().decode(
            NativeSubagentSummary.self,
            from: Data(
                #"""
                {
                  "id": "run-1",
                  "label": "Review repository",
                  "status": "completed",
                  "requesterSessionId": "chat-1",
                  "task": "Review the repository",
                  "result": "Review complete",
                  "thinking": "I should inspect the package first.",
                  "activityCount": 2,
                  "toolCallCount": 1,
                  "activities": [
                    {
                      "id": "activity-1",
                      "phase": "result",
                      "text": "Read package metadata",
                      "timestamp": 100,
                      "toolName": "read",
                      "toolCallId": "read-1"
                    }
                  ],
                  "toolCalls": [
                    {
                      "id": "read-1",
                      "name": "read",
                      "args": { "path": "package.json" },
                      "result": { "content": "package metadata" },
                      "status": "completed",
                      "timeline_index": 1
                    }
                  ]
                }
                """#.utf8
            )
        )

        XCTAssertEqual(detail.requesterSessionId, "chat-1")
        XCTAssertEqual(detail.thinking, "I should inspect the package first.")
        XCTAssertEqual(detail.activities?.first?.text, "Read package metadata")
        XCTAssertEqual(detail.toolCalls?.first?.name, "read")
        XCTAssertEqual(detail.toolCalls?.first?.args?["path"]?.displayString, "package.json")
        XCTAssertTrue(detail.toolCalls?.first?.result?.displayString.contains("package metadata") == true)
        XCTAssertEqual(detail.result, "Review complete")
    }

    func testNativeSubagentSpawnResponseDecodesGatewayResult() throws {
        let response = try JSONDecoder().decode(
            NativeSubagentMutationResponse.self,
            from: Data(
                #"{"success":true,"subagentId":"run-2","sessionKey":"agent:mini:subagent:2","status":"accepted"}"#.utf8
            )
        )

        XCTAssertEqual(response.success, true)
        XCTAssertEqual(response.subagentId, "run-2")
        XCTAssertEqual(response.sessionKey, "agent:mini:subagent:2")
        XCTAssertEqual(response.status, "accepted")
    }

    private func decodeSession(_ json: String) throws -> GatewaySession {
        try JSONDecoder().decode(GatewaySession.self, from: Data(json.utf8))
    }

    private func decodeProvider(_ json: String) throws -> GatewayProvider {
        try JSONDecoder().decode(GatewayProvider.self, from: Data(json.utf8))
    }

    private func decodeAgent(_ json: String) throws -> GatewayAgent {
        try JSONDecoder().decode(GatewayAgent.self, from: Data(json.utf8))
    }

    private func decodeTask(_ json: String) throws -> GatewayTask {
        try JSONDecoder().decode(GatewayTask.self, from: Data(json.utf8))
    }

    private func decodeSessionMessage(_ json: String) throws -> GatewaySessionMessage {
        try JSONDecoder().decode(GatewaySessionMessage.self, from: Data(json.utf8))
    }

    private func decodeChannel(_ json: String) throws -> GatewayChannel {
        try JSONDecoder().decode(GatewayChannel.self, from: Data(json.utf8))
    }

    private func decodeStatusEvent(_ json: String) throws -> GatewayStatusEvent {
        try JSONDecoder().decode(GatewayStatusEvent.self, from: Data(json.utf8))
    }
}
