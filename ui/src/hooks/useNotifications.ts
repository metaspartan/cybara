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

// Check if running in Tauri desktop app
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

// Tauri notification API (lazy loaded)
async function sendTauriNotification(title: string, body?: string) {
    if (!isTauri) return;
    try {
        const { sendNotification, isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');

        let granted = await isPermissionGranted();
        if (!granted) {
            const permission = await requestPermission();
            granted = permission === 'granted';
        }

        if (granted) {
            sendNotification({ title, body: body || '' });
        }
    } catch (e) {
        console.warn('Tauri notification failed:', e);
    }
}

export function useNotifications() {
    const [permission, setPermission] = useState<NotificationPermission>(
        typeof Notification !== 'undefined' ? Notification.permission : 'denied'
    );

    const requestPermission = useCallback(async () => {
        // For Tauri, use native notification API
        if (isTauri) {
            try {
                const { isPermissionGranted, requestPermission: tauriRequest } = await import('@tauri-apps/plugin-notification');
                let granted = await isPermissionGranted();
                if (!granted) {
                    const result = await tauriRequest();
                    granted = result === 'granted';
                }
                setPermission(granted ? 'granted' : 'denied');
                return granted ? 'granted' : 'denied';
            } catch {
                return 'denied';
            }
        }

        // Browser fallback
        if (typeof Notification === 'undefined') return 'denied';

        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
    }, []);

    const showNotification = useCallback((title: string, options?: NotificationOptions) => {
        // For Tauri, use native notifications
        if (isTauri) {
            sendTauriNotification(title, options?.body);
            return null;
        }

        // Browser fallback
        if (permission !== 'granted') return null;

        const notification = new Notification(title, {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            ...options,
        });

        return notification;
    }, [permission]);

    // Initialize Tauri permission state
    useEffect(() => {
        if (isTauri) {
            import('@tauri-apps/plugin-notification').then(({ isPermissionGranted }) => {
                isPermissionGranted().then(granted => {
                    setPermission(granted ? 'granted' : 'default');
                });
            }).catch(() => { });
        }
    }, []);

    return { permission, requestPermission, showNotification, isTauri };
}

export function useTaskNotifications() {
    const { permission, requestPermission, showNotification, isTauri } = useNotifications();
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

                    // Show notification (browser or native)
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

    return { permission, requestPermission, connected, isTauri };
}
