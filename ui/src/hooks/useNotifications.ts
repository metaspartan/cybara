import { useEffect, useState, useCallback } from 'react';

interface TaskEvent {
    type: 'task_completed';
    taskId: string;
    taskName: string;
    status: 'completed' | 'failed';
    sessionId?: string;
    resultPreview?: string;
    error?: string;
    timestamp?: number;
}

export function useNotifications() {
    const [permission, setPermission] = useState<NotificationPermission>(
        typeof Notification !== 'undefined' ? Notification.permission : 'denied'
    );

    const requestPermission = useCallback(async () => {
        if (typeof Notification === 'undefined') return 'denied';

        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
    }, []);

    const showNotification = useCallback((title: string, options?: NotificationOptions) => {
        if (permission !== 'granted') return null;

        const notification = new Notification(title, {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            ...options,
        });

        return notification;
    }, [permission]);

    return { permission, requestPermission, showNotification };
}

export function useTaskNotifications() {
    const { permission, requestPermission, showNotification } = useNotifications();
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        // Connect to SSE for task events
        const eventSource = new EventSource('/api/sse/status');

        eventSource.onopen = () => {
            setConnected(true);
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data) as TaskEvent | { status: string };

                // Check if this is a task_completed event
                if ('type' in data && data.type === 'task_completed') {
                    const taskEvent = data as TaskEvent;

                    // Show browser notification
                    if (taskEvent.status === 'completed') {
                        showNotification(`Task Completed: ${taskEvent.taskName}`, {
                            body: taskEvent.resultPreview?.slice(0, 100) || 'Task finished successfully',
                            tag: `task-${taskEvent.taskId}`,
                        });
                    } else {
                        showNotification(`Task Failed: ${taskEvent.taskName}`, {
                            body: taskEvent.error?.slice(0, 100) || 'Task execution failed',
                            tag: `task-${taskEvent.taskId}`,
                        });
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        };

        eventSource.onerror = () => {
            setConnected(false);
        };

        return () => {
            eventSource.close();
        };
    }, [showNotification]);

    return { permission, requestPermission, connected };
}
