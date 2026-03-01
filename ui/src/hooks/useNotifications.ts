import { useEffect, useState, useCallback } from 'react';
import {
    isPermissionGranted as tauriIsPermissionGranted,
    requestPermission as tauriRequestPermission,
    sendNotification as tauriSendNotification,
} from '@tauri-apps/plugin-notification';
import { connectStatusStream } from '@/lib/status-stream';

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

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

async function sendTauriNotification(title: string, body?: string) {
    if (!isTauri) return;
    try {
        let granted = await tauriIsPermissionGranted();
        if (!granted) {
            const permission = await tauriRequestPermission();
            granted = permission === 'granted';
        }

        if (granted) {
            tauriSendNotification({ title, body: body || '' });
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
        if (isTauri) {
            try {
                let granted = await tauriIsPermissionGranted();
                if (!granted) {
                    const result = await tauriRequestPermission();
                    granted = result === 'granted';
                }
                setPermission(granted ? 'granted' : 'denied');
                return granted ? 'granted' : 'denied';
            } catch {
                return 'denied';
            }
        }

        if (typeof Notification === 'undefined') return 'denied';

        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
    }, []);

    const showNotification = useCallback((title: string, options?: NotificationOptions) => {
        if (isTauri) {
            sendTauriNotification(title, options?.body);
            return null;
        }

        if (permission !== 'granted') return null;

        const notification = new Notification(title, {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            ...options,
        });

        return notification;
    }, [permission]);

    useEffect(() => {
        if (isTauri) {
            tauriIsPermissionGranted()
                .then(granted => {
                    setPermission(granted ? 'granted' : 'default');
                })
                .catch(() => { });
        }
    }, []);

    return { permission, requestPermission, showNotification, isTauri };
}

export function useTaskNotifications() {
    const { permission, requestPermission, showNotification, isTauri } = useNotifications();
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const disconnect = connectStatusStream({
            onOpen: () => setConnected(true),
            onClose: () => setConnected(false),
            onEvent: (data) => {
                if (!data || data.type !== 'task_completed') return;
                const taskEvent = data as TaskEvent;

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
            },
        });

        return () => {
            disconnect();
        };
    }, [showNotification]);

    return { permission, requestPermission, connected, isTauri };
}
