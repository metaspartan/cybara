import XCTest

@testable import Cybara

final class GatewayRuntimeModelTests: XCTestCase {
    func testNativeCompactingStatusWaitsForCompletionBeforeRecordingActivity() throws {
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
        XCTAssertNil(activity)

        let completed = try decodeStatusEvent(
            #"""
            {
              "type": "status",
              "status": "thinking",
              "detail": "Context compacted · 4,200 tokens freed",
              "timestamp": 1783015200200,
              "sessionId": "session-1"
            }
            """#
        )
        let completedActivity = nativeLiveActivity(from: completed)
        XCTAssertEqual(completedActivity?.toolName, "__thought")
        XCTAssertEqual(completedActivity?.phase, .result)
        XCTAssertEqual(completedActivity?.text, "Context compacted · 4,200 tokens freed")
    }

    func testNativeStatusEventsDecodeLiveToolActivityAndSnapshots() throws {
        let status = try decodeStatusEvent(
            #"""
            {
              "type": "status",
              "status": "tool_executing",
              "timestamp": 1783015200500,
              "sessionId": "session-1",
              "runId": "run-1",
              "sequence": 3,
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
                  "runId": "run-1",
                  "sequence": 4,
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
        XCTAssertEqual(status.runId, "run-1")
        XCTAssertEqual(status.sequence, 3)
        XCTAssertEqual(status.toolCallId, "tool-1")
        XCTAssertEqual(status.sandboxProvider, "host")
        let liveActivity = try XCTUnwrap(nativeLiveActivity(from: status))
        XCTAssertEqual(liveActivity.phase, .start)
        XCTAssertEqual(liveActivity.text, "Running bun test")
        XCTAssertEqual(liveActivity.sandboxProvider, "host")
        XCTAssertEqual(snapshot.activeSessionIds, ["session-1"])
        XCTAssertEqual(snapshot.activeSessions[0].runId, "run-1")
        XCTAssertEqual(snapshot.activeSessions[0].sequence, 4)
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

    func testCybaraMenuBarTemplateUsesFixedSizeAndPreservesDetails() throws {
        let image = try XCTUnwrap(CybaraBrand.menuBarTemplateImage())
        let bitmap = try XCTUnwrap(image.representations.first as? NSBitmapImageRep)

        XCTAssertTrue(image.isTemplate)
        XCTAssertEqual(image.size, NSSize(width: 16, height: 16))
        XCTAssertLessThan(bitmap.colorAt(x: 0, y: 0)?.alphaComponent ?? 1, 0.05)
        XCTAssertGreaterThan(bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh / 2)?.alphaComponent ?? 0, 0.85)
    }

    func testCybaraMenuBarTemplateMatchesTheDesktopLuminanceMask() {
        XCTAssertEqual(
            CybaraBrand.menuBarTemplateAlpha(red: 0, green: 0, blue: 0, alpha: 255),
            0
        )
        XCTAssertEqual(
            CybaraBrand.menuBarTemplateAlpha(red: 210, green: 150, blue: 90, alpha: 255),
            255
        )
        XCTAssertEqual(
            CybaraBrand.menuBarTemplateAlpha(red: 105, green: 75, blue: 45, alpha: 128),
            128
        )
        XCTAssertEqual(
            CybaraBrand.menuBarTemplateAlpha(red: 255, green: 255, blue: 255, alpha: 0),
            0
        )
    }

    @MainActor
    func testWorkspaceOpenTargetBitmapUsesMenuIconSize() throws {
        let source = NSImage(size: NSSize(width: 512, height: 512))
        let display = NativeWorkspaceOpenTargetIcon.displayImage(source)

        XCTAssertEqual(display.size.width, 14)
        XCTAssertEqual(display.size.height, 14)
        XCTAssertEqual(source.size.width, 512)
        XCTAssertEqual(source.size.height, 512)
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

    func testNativeChatAppearanceReadsSharedConfigAndBuildsPayload() {
        let appearance = NativeChatAppearanceSettings(config: [
            "chat_appearance": [
                "font_size": "extra_large",
                "codeFontSize": "large",
                "line_spacing": "spacious",
                "horizontal_padding": "wide",
                "reduce_motion": true,
                "reduceTransparency": true,
                "high_contrast": true,
                "underlineLinks": true,
            ],
        ])

        XCTAssertEqual(appearance.fontSize, "extra_large")
        XCTAssertEqual(appearance.codeFontSize, "large")
        XCTAssertEqual(appearance.lineSpacing, "spacious")
        XCTAssertEqual(appearance.horizontalPadding, "wide")
        XCTAssertEqual(appearance.bodyFontSize, 18)
        XCTAssertEqual(appearance.codeTextSize, 14)
        XCTAssertTrue(appearance.reduceMotion)
        XCTAssertTrue(appearance.reduceTransparency)
        XCTAssertTrue(appearance.highContrast)
        XCTAssertTrue(appearance.underlineLinks)
        XCTAssertEqual(appearance.payload["fontSize"] as? String, "extra_large")
        XCTAssertEqual(appearance.payload["horizontalPadding"] as? String, "wide")
    }

    func testNativeSessionEventCursorRejectsStaleEventsAcrossRuns() {
        var cursor = NativeSessionEventCursor()
        let first = cursor.accept(runId: "run-a", sequence: 4, timestamp: 100)
        let nextRun = cursor.accept(runId: "run-b", sequence: 5, timestamp: 110)
        let delayed = cursor.accept(runId: "run-a", sequence: 3, timestamp: 120)

        XCTAssertTrue(first.accepted)
        XCTAssertFalse(first.runChanged)
        XCTAssertTrue(nextRun.accepted)
        XCTAssertTrue(nextRun.runChanged)
        XCTAssertFalse(delayed.accepted)
        XCTAssertEqual(cursor.runId, "run-b")
        XCTAssertEqual(cursor.sequence, 5)
    }
}
