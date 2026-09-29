import { spawn } from "node:child_process";

/**
 * Starts Vite on 127.0.0.1:5173 and a Cloudflare quick tunnel (valid HTTPS).
 * Open the printed https://….trycloudflare.com URL on PC and phone — same link, no cert warning.
 */
const vite = spawn("npx", ["vite"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    cwd: process.cwd(),
    env: process.env,
});

function pipe(prefix, stream) {
    stream.on("data", (buf) => {
        const text = buf.toString();
        for (const line of text.split(/\r?\n/)) {
            if (line.trim()) console.log(`[${prefix}] ${line}`);
        }
    });
}

pipe("vite", vite.stdout);
pipe("vite", vite.stderr);

let tunnelStarted = false;

function startTunnel() {
    if (tunnelStarted) return;
    tunnelStarted = true;

    const tunnel = spawn(
        "npx",
        ["--yes", "cloudflared", "tunnel", "--url", "http://127.0.0.1:5173"],
        { stdio: ["ignore", "pipe", "pipe"], shell: true, cwd: process.cwd() }
    );

    const onData = (buf) => {
        const text = buf.toString();
        process.stderr.write(text);
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
            console.log("\n========================================");
            console.log("  PUBLIC URL (PC + phone, one link):");
            console.log(`  ${match[0]}`);
            console.log("========================================\n");
        }
    };

    tunnel.stdout.on("data", onData);
    tunnel.stderr.on("data", onData);

    tunnel.on("exit", (code) => {
        console.error(`[tunnel] exited ${code}`);
        vite.kill();
        process.exit(code ?? 1);
    });
}

vite.stdout.on("data", (buf) => {
    if (buf.toString().includes("Local:")) startTunnel();
});
vite.stderr.on("data", (buf) => {
    if (buf.toString().includes("Local:")) startTunnel();
});

vite.on("exit", (code) => {
    process.exit(code ?? 0);
});

process.on("SIGINT", () => {
    vite.kill();
    process.exit(0);
});
