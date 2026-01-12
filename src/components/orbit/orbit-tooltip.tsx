"use client";

type OrbitLevel = "EXPLORER" | "PARTICIPANT" | "CONTRIBUTOR" | "ADVOCATE";

export type TooltipMember = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  headline?: string | null;
  orbitLevel: OrbitLevel;
  reachScore: number;
  tags?: string[];
};

export default function OrbitTooltip(props: {
  member: TooltipMember;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
}) {
  const { member, x, y, containerWidth, containerHeight } = props;

  const pad = 10;
  const idealW = 280;
  const h = member.tags?.length ? 92 : 74;

  const maxW = Math.max(0, containerWidth - pad * 2);
  const w = Math.min(idealW, maxW);

  const left = Math.max(pad, Math.min(x + 12, containerWidth - w - pad));
  const top = Math.max(pad, Math.min(y + 12, containerHeight - h - pad));

  const chips = (member.tags ?? []).slice(0, 3);

  return (
    <div
      role="tooltip"
      aria-label={member.name}
      className="pointer-events-none absolute z-10 rounded-xl border border-border bg-background/85 p-3 text-sm text-foreground shadow-sm backdrop-blur"
      style={{ left, top, width: w }}
    >
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 overflow-hidden rounded-lg border border-border bg-muted">
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{member.name}</div>
          <div className="truncate text-xs text-foreground/70">
            {member.headline ?? member.orbitLevel}
          </div>
        </div>

        <div className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] text-foreground/70">
          {member.orbitLevel}
        </div>
      </div>

      {chips.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((t) => (
            <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground/70">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}