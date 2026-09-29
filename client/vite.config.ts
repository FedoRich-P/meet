import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const apiTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:5000";

    return {
        plugins: [react(), tailwindcss(), basicSsl()],
        server: {
            host: true,
            port: 5173,
            strictPort: true,
            proxy: {
                "/socket.io": {
                    target: apiTarget,
                    changeOrigin: true,
                    ws: true,
                },
                "/api": {
                    target: apiTarget,
                    changeOrigin: true,
                },
            },
        },
    };
});
