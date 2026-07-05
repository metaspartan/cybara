import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

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
                ws: true,
                rewriteWsOrigin: true,
                configure: (proxy) => {
                    proxy.on('proxyReqWs', (proxyReq) => {
                        proxyReq.setHeader('origin', 'http://localhost:4269');
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
