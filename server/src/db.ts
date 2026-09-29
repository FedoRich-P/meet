import dns from "dns";
import mongoose from "mongoose";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

type DohAnswerType = {
    data?: string;
};

async function dnsJson(name: string, type: string): Promise<DohAnswerType[]> {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
    const res = await fetch(url, { headers: { accept: "application/dns-json" } });
    if (!res.ok) {
        throw new Error(`DoH HTTP ${res.status} for ${name} ${type}`);
    }
    const data = (await res.json()) as { Answer?: DohAnswerType[] };
    return data.Answer || [];
}

/**
 * ISP/local DNS often fails on `_mongodb._tcp` SRV (querySrv ETIMEOUT).
 * Resolve via Cloudflare DoH and build a classic mongodb:// multi-host URI.
 */
export async function mongoUriFromSrv(srvUri: string): Promise<string> {
    if (!srvUri.startsWith("mongodb+srv://")) {
        return srvUri;
    }

    const u = new URL(srvUri.replace("mongodb+srv://", "https://"));
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    const host = u.hostname;
    const dbName = u.pathname.replace(/^\//, "") || "meet";

    const srv = await dnsJson(`_mongodb._tcp.${host}`, "SRV");
    if (!srv.length) {
        throw new Error(`DoH: нет SRV записей для _mongodb._tcp.${host}`);
    }

    const hosts = srv.map((a) => {
        const parts = (a.data || "").trim().split(/\s+/);
        const port = parts[2];
        const target = parts[3]?.replace(/\.$/, "");
        if (!port || !target) {
            throw new Error(`DoH: битая SRV запись: ${a.data}`);
        }
        return `${target}:${port}`;
    });

    const txt = await dnsJson(host, "TXT");
    const txtData = (txt[0]?.data || "").replace(/"/g, "");
    const params = new URLSearchParams(txtData);
    params.set("ssl", "true");
    params.set("retryWrites", "true");
    params.set("w", "majority");
    params.set("authSource", params.get("authSource") || "admin");

    const appName = u.searchParams.get("appName");
    if (appName) params.set("appName", appName);

    return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hosts.join(",")}/${dbName}?${params.toString()}`;
}

export async function connectDb(uri: string): Promise<void> {
    mongoose.set("strictQuery", true);

    const resolved = await mongoUriFromSrv(uri);
    console.log("MongoDB: connecting via DoH-resolved hosts...");

    await mongoose.connect(resolved, {
        serverSelectionTimeoutMS: 20000,
        family: 4,
    });

    console.log("MongoDB connected");
}

export function isDbReady(): boolean {
    return mongoose.connection.readyState === 1;
}
