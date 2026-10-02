import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Event Management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: "#211b18", color: "#f7f1e8", fontFamily: "sans-serif" }}>
      <div style={{ color: "#efb255", fontSize: 28, letterSpacing: 4, textTransform: "uppercase" }}>Event Management</div>
      <div style={{ marginTop: 28, fontSize: 68, fontWeight: 700, lineHeight: 1.05 }}>Plan moments that feel unforgettable.</div>
      <div style={{ marginTop: 28, color: "#c4b8ac", fontSize: 30 }}>Clear quotes. Reliable operations. Memorable events.</div>
    </div>,
    { ...size },
  );
}
