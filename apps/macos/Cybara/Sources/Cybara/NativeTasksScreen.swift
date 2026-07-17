import SwiftUI

struct TasksScreen: View {
    let client: GatewayClient
    var openChat: (String) -> Void = { _ in }

    @State private var tasks: [GatewayTask] = []
    @State private var agents: [GatewayAgent] = []
    @State private var sessions: [GatewaySession] = []
    @State private var searchText = ""
    @State private var expandedTaskID: String?
    @State private var taskRuns: [String: [GatewayTaskRun]] = [:]
    @State private var runsLoadingTaskID: String?
    @State private var showingEditor = false
    @State private var editingTask: GatewayTask?
    @State private var deletingTask: GatewayTask?
    @State private var busyTask: String?
    @State private var error: String?

    private var filteredTasks: [GatewayTask] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return tasks }
        return tasks.filter { task in
            [
                task.name,
                task.description ?? "",
                task.action ?? "",
                task.schedule ?? "",
                task.statusLabel,
            ].joined(separator: " ").lowercased().contains(query)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    ScreenHeader(title: "Tasks", subtitle: "Scheduled agent automations")
                    Spacer()
                    Button {
                        editingTask = nil
                        showingEditor = true
                    } label: {
                        Label("New Task", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .help("Refresh tasks")
                }

                if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    taskToolbar

                    if filteredTasks.isEmpty {
                        taskEmptyState
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredTasks) { task in
                                taskRow(task)
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .sheet(isPresented: $showingEditor) {
            TaskEditorSheet(task: editingTask, agents: agents, sessions: sessions) { draft in
                try await saveTask(draft)
            }
            .frame(minWidth: 520, idealWidth: 560, minHeight: 620)
        }
        .confirmationDialog(
            "Delete “\(deletingTask?.name ?? "task")”?",
            isPresented: deleteDialogBinding,
            titleVisibility: .visible
        ) {
            Button("Delete Task", role: .destructive) {
                if let deletingTask {
                    Task { await delete(deletingTask) }
                }
            }
            Button("Cancel", role: .cancel) { deletingTask = nil }
        } message: {
            Text("This removes the scheduled task and its run history.")
        }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(
            get: { deletingTask != nil },
            set: { if !$0 { deletingTask = nil } }
        )
    }

    private var taskToolbar: some View {
        HStack(spacing: 12) {
            TextField("Search tasks", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 360)
            Spacer()
            taskSummary("Active", tasks.filter(\.isRunning).count, "checkmark.circle", .green)
            taskSummary("Paused", tasks.filter { $0.status?.lowercased() == "paused" }.count, "pause.circle", .orange)
            taskSummary("Total", tasks.count, "calendar.badge.clock", .secondary)
        }
    }

    private var taskEmptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(tasks.isEmpty ? "No scheduled tasks yet." : "No matching tasks.")
                .font(.system(size: 14, weight: .semibold, design: .rounded))
            Button {
                editingTask = nil
                showingEditor = true
            } label: {
                Label("Create Task", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .cybaraGlass(cornerRadius: 18)
    }

    private func taskSummary(_ label: String, _ value: Int, _ systemImage: String, _ tint: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            Text("\(value)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
            Text(label)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.055))
        )
    }

    private func taskRow(_ task: GatewayTask) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: task.isRunning ? "calendar.badge.checkmark" : "calendar.badge.clock")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(task.isRunning ? Color.green : Color.secondary)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(Color.white.opacity(0.065)))

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(task.name)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .lineLimit(1)
                        taskStatusPill(task)
                    }
                    if let description = firstNonEmptyGatewayString(task.description) {
                        Text(description)
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Text(taskDetailLine(task))
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let action = firstNonEmptyGatewayString(task.action) {
                        Text(action)
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.primary.opacity(0.82))
                            .lineLimit(2)
                            .padding(.top, 1)
                    }
                }

                Spacer(minLength: 12)

                taskActions(task)
            }

            if expandedTaskID == task.id {
                taskHistory(task)
                    .padding(.leading, 52)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cybaraGlass(cornerRadius: 18)
    }

    @ViewBuilder
    private func taskActions(_ task: GatewayTask) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                taskActionButtons(task)
            }
            Menu {
                taskActionButtons(task)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
        }
    }

    @ViewBuilder
    private func taskActionButtons(_ task: GatewayTask) -> some View {
        Button {
            Task { await run(task) }
        } label: {
            Label("Run", systemImage: "play.fill")
        }
        .disabled(busyTask == task.id)

        Button {
            Task { await toggle(task) }
        } label: {
            Label(task.isRunning ? "Pause" : "Resume", systemImage: task.isRunning ? "pause.fill" : "play")
        }
        .disabled(busyTask == task.id)

        Button {
            editingTask = task
            showingEditor = true
        } label: {
            Label("Edit", systemImage: "pencil")
        }

        Button {
            Task { await toggleHistory(task) }
        } label: {
            Label(expandedTaskID == task.id ? "Hide History" : "History", systemImage: "clock.arrow.circlepath")
        }

        Button(role: .destructive) {
            deletingTask = task
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    private func taskStatusPill(_ task: GatewayTask) -> some View {
        Text(task.statusLabel)
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(task.isRunning ? Color.green : Color.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill((task.isRunning ? Color.green : Color.secondary).opacity(0.13))
            )
    }

    private func taskHistory(_ task: GatewayTask) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if runsLoadingTaskID == task.id {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading history")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            } else if let runs = taskRuns[task.id], !runs.isEmpty {
                ForEach(runs) { run in
                    taskRunRow(run)
                }
            } else {
                Text("No runs yet.")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 2)
    }

    private func taskRunRow(_ run: GatewayTaskRun) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: taskRunIcon(run.status))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(taskRunTint(run.status))
                .frame(width: 24, height: 24)
                .background(Circle().fill(taskRunTint(run.status).opacity(0.13)))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(run.status.capitalized)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                    if let started = firstNonEmptyGatewayString(absoluteTimestamp(run.started_at), relativeTimestamp(run.started_at)) {
                        Text(started)
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                if let preview = firstNonEmptyGatewayString(run.result_preview) {
                    Text(preview)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.primary.opacity(0.8))
                        .lineLimit(2)
                }
                if let error = firstNonEmptyGatewayString(run.error) {
                    Text(error)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
                if let sessionID = firstNonEmptyGatewayString(run.session_id) {
                    Button {
                        openChat(sessionID)
                    } label: {
                        Label("Open Chat", systemImage: "bubble.left")
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                }
            }
            Spacer()
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.045))
        )
    }

    private func taskDetailLine(_ task: GatewayTask) -> String {
        var parts: [String] = []
        parts.append(task.schedule.map(formatTaskSchedule) ?? "Manual")
        if let agent = agents.first(where: { $0.id == task.agent_id }) {
            parts.append(agent.name)
        } else if let agentID = firstNonEmptyGatewayString(task.agent_id) {
            parts.append(agentID)
        } else {
            parts.append("Automatic agent")
        }
        if let session = sessions.first(where: { $0.id == task.session_id }) {
            parts.append(session.displayTitle)
        } else if task.session_id != nil {
            parts.append("Assigned chat")
        }
        let lastRun = relativeTimestamp(task.last_run)
        if !lastRun.isEmpty { parts.append("Last \(lastRun)") }
        let nextRun = relativeTimestamp(task.next_run)
        if !nextRun.isEmpty { parts.append("Next \(nextRun)") }
        return parts.joined(separator: " · ")
    }

    private func taskRunIcon(_ status: String) -> String {
        switch status.lowercased() {
        case "completed": return "checkmark.circle.fill"
        case "failed": return "xmark.circle.fill"
        case "running": return "arrow.triangle.2.circlepath"
        default: return "circle"
        }
    }

    private func taskRunTint(_ status: String) -> Color {
        switch status.lowercased() {
        case "completed": return .green
        case "failed": return .red
        case "running": return .orange
        default: return .secondary
        }
    }

    private func load() async {
        do {
            async let loadedTasks = client.tasks()
            async let loadedAgents = client.agents()
            async let loadedSessions = client.sessions(limit: 200)
            tasks = try await loadedTasks
            agents = try await loadedAgents
            sessions = try await loadedSessions
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveTask(_ draft: NativeTaskDraft) async throws {
        if let editingTask {
            try await client.updateTask(
                editingTask.id,
                name: draft.name,
                description: draft.description,
                agentID: draft.agentID,
                sessionID: draft.sessionID,
                action: draft.action,
                schedule: draft.schedule,
                enabled: draft.enabled
            )
        } else {
            try await client.createTask(
                name: draft.name,
                description: draft.description,
                agentID: draft.agentID,
                sessionID: draft.sessionID,
                action: draft.action,
                schedule: draft.schedule,
                enabled: draft.enabled
            )
        }
        showingEditor = false
        editingTask = nil
        await load()
    }

    private func run(_ task: GatewayTask) async {
        busyTask = task.id
        do {
            try await client.triggerTask(task.id)
            await load()
            if expandedTaskID == task.id {
                await loadRuns(task.id)
            }
        } catch {
            self.error = error.localizedDescription
        }
        busyTask = nil
    }

    private func toggle(_ task: GatewayTask) async {
        busyTask = task.id
        do {
            if task.isRunning {
                try await client.stopTask(task.id)
            } else {
                try await client.startTask(task.id)
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyTask = nil
    }

    private func delete(_ task: GatewayTask) async {
        deletingTask = nil
        busyTask = task.id
        do {
            try await client.deleteTask(task.id)
            if expandedTaskID == task.id {
                expandedTaskID = nil
            }
            taskRuns.removeValue(forKey: task.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyTask = nil
    }

    private func toggleHistory(_ task: GatewayTask) async {
        if expandedTaskID == task.id {
            expandedTaskID = nil
            return
        }
        expandedTaskID = task.id
        await loadRuns(task.id)
    }

    private func loadRuns(_ taskID: String) async {
        runsLoadingTaskID = taskID
        do {
            taskRuns[taskID] = try await client.taskRuns(taskID)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        runsLoadingTaskID = nil
    }
}

private struct NativeTaskDraft {
    let name: String
    let description: String
    let agentID: String?
    let sessionID: String?
    let action: String
    let schedule: String
    let enabled: Bool
}

private struct TaskSchedulePreset: Identifiable, Hashable {
    let id: String
    let label: String
}

private let nativeTaskSchedulePresets = [
    TaskSchedulePreset(id: "*/5 * * * *", label: "Every 5 minutes"),
    TaskSchedulePreset(id: "*/15 * * * *", label: "Every 15 minutes"),
    TaskSchedulePreset(id: "0 * * * *", label: "Every hour"),
    TaskSchedulePreset(id: "0 */6 * * *", label: "Every 6 hours"),
    TaskSchedulePreset(id: "0 0 * * *", label: "Daily at midnight"),
    TaskSchedulePreset(id: "0 9 * * 1", label: "Monday at 9 AM"),
]

private func formatTaskSchedule(_ schedule: String) -> String {
    nativeTaskSchedulePresets.first { $0.id == schedule }?.label ?? schedule
}

private struct TaskEditorSheet: View {
    let task: GatewayTask?
    let agents: [GatewayAgent]
    let sessions: [GatewaySession]
    let onSave: (NativeTaskDraft) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var description: String
    @State private var agentID: String
    @State private var sessionID: String
    @State private var action: String
    @State private var schedulePreset: String
    @State private var customSchedule: String
    @State private var enabled: Bool
    @State private var saving = false
    @State private var error: String?

    init(
        task: GatewayTask?,
        agents: [GatewayAgent],
        sessions: [GatewaySession],
        onSave: @escaping (NativeTaskDraft) async throws -> Void
    ) {
        self.task = task
        self.agents = agents
        self.sessions = sessions
        self.onSave = onSave
        let schedule = task?.schedule ?? "0 * * * *"
        let isPreset = nativeTaskSchedulePresets.contains { $0.id == schedule }
        _name = State(initialValue: task?.name ?? "")
        _description = State(initialValue: task?.description ?? "")
        _agentID = State(initialValue: task?.agent_id ?? "")
        _sessionID = State(initialValue: task?.session_id ?? "")
        _action = State(initialValue: task?.action ?? "")
        _schedulePreset = State(initialValue: isPreset ? schedule : "custom")
        _customSchedule = State(initialValue: isPreset ? "*/5 * * * *" : schedule)
        _enabled = State(initialValue: task?.isRunning ?? true)
    }

    private var selectedSchedule: String {
        schedulePreset == "custom" ? customSchedule : schedulePreset
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !action.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !selectedSchedule.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !saving
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                ScreenHeader(
                    title: task == nil ? "New Task" : "Edit Task",
                    subtitle: "Schedule an agent prompt through the local gateway"
                )
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 14) {
                TextField("Task name", text: $name)
                    .textFieldStyle(.roundedBorder)

                TextField("Description", text: $description)
                    .textFieldStyle(.roundedBorder)

                Picker("Agent", selection: $agentID) {
                    Text(sessionID.isEmpty ? "Gateway default" : "Use chat's agent").tag("")
                    ForEach(agents) { agent in
                        Text(agent.name).tag(agent.id)
                    }
                }
                .pickerStyle(.menu)

                Picker("Chat context", selection: $sessionID) {
                    Text("New chat for each run").tag("")
                    ForEach(sessions) { session in
                        Text(session.displayTitle).tag(session.id)
                    }
                }
                .pickerStyle(.menu)

                VStack(alignment: .leading, spacing: 7) {
                    Text("Action")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    TextEditor(text: $action)
                        .font(.system(size: 13, design: .rounded))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 110)
                        .padding(8)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.white.opacity(0.055))
                        )
                }

                Picker("Schedule", selection: $schedulePreset) {
                    ForEach(nativeTaskSchedulePresets) { preset in
                        Text(preset.label).tag(preset.id)
                    }
                    Text("Custom").tag("custom")
                }
                .pickerStyle(.menu)

                if schedulePreset == "custom" {
                    TextField("Cron expression", text: $customSchedule)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 13, design: .monospaced))
                }

                Toggle("Enabled", isOn: $enabled)
                    .toggleStyle(.switch)
            }
            .padding(16)
            .cybaraGlass(cornerRadius: 18)

            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
            }

            Spacer()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button {
                    Task { await save() }
                } label: {
                    if saving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(task == nil ? "Create" : "Save")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSave)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
    }

    private func save() async {
        let draft = NativeTaskDraft(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            agentID: firstNonEmptyGatewayString(agentID),
            sessionID: firstNonEmptyGatewayString(sessionID),
            action: action.trimmingCharacters(in: .whitespacesAndNewlines),
            schedule: selectedSchedule.trimmingCharacters(in: .whitespacesAndNewlines),
            enabled: enabled
        )
        saving = true
        do {
            try await onSave(draft)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

