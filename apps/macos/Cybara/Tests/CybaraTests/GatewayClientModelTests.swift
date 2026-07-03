import XCTest

@testable import Cybara

final class GatewayClientModelTests: XCTestCase {

    func testSessionDisplayTitleTrimsGatewayTitle() throws {
        let session = try decodeSession(#"{"id":"session-123456789","title":"  Release planning  "}"#)

        XCTAssertEqual(session.displayTitle, "Release planning")
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
        XCTAssertEqual(nativeLiveActivities(from: snapshot.activeSessions[0]).first?.phase, .start)
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
                  "createdAt": "2026-07-02T18:00:00.000Z"
                }
                """#.utf8
            )
        )

        XCTAssertTrue(device.isActive)
        XCTAssertEqual(device.scopeSummary, "chat, manage, read")
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
