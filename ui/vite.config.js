import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:4269',
                changeOrigin: true,
                // The live status stream (/api/ws/status) is a WebSocket. The gateway
                // only grants the localhost auth bypass to same-origin requests, so
                // the proxied upgrade must rewrite BOTH Host (changeOrigin) and the
                // Origin header (rewriteWsOrigin) or live chat state silently dies
                // in dev.
                ws: true,
                rewriteWsOrigin: true,
                // rewriteWsOrigin is a no-op in rolldown-vite 8, so rewrite the
                // upgrade Origin ourselves; the gateway only grants the localhost
                // bypass to same-origin requests.
                configure: (proxy) => {
                    proxy.on("proxyReqWs", (proxyReq) => {
                        proxyReq.setHeader("origin", "http://localhost:4269");
                    });
                },
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
