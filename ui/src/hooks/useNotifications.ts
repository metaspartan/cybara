import { useEffect, useState, useCallback } from 'react';
import { connectStatusStream } from '@/lib/status-stream';
import {
    getDesktopHostRuntime,
    getDesktopNotificationPermission,
    requestDesktopNotificationPermission,
    sendDesktopNotification,
} from '@/lib/desktopHost';

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
    const desktopRuntime = getDesktopHostRuntime();
    const [permission, setPermission] = useState<NotificationPermission>(
        typeof Notification !== 'undefined' ? Notification.permission : 'denied'
    );

    const requestPermission = useCallback(async () => {
        if (desktopRuntime) {
            try {
                const result = await requestDesktopNotificationPermission();
                setPermission(result);
                return result;
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
        if (desktopRuntime) {
            void sendDesktopNotification(title, options);
            return null;
        }

        if (permission !== 'granted') return null;

        const notification = new Notification(title, {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            ...options,
        });

        return notification;
    }, [desktopRuntime, permission]);

    useEffect(() => {
        if (desktopRuntime) {
            void getDesktopNotificationPermission()
                .then((nextPermission) => {
                    setPermission(nextPermission);
                })
                .catch(() => { });
        }
    }, [desktopRuntime]);

    return { permission, requestPermission, showNotification, isTauri: desktopRuntime === 'tauri' };
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
