"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ── Types ──────────────────────────────────────────────────────────

export interface EventFiltersPanelProps {
  q: string;
  filterValue: string;
  filterLabel?: string;
  filterOptions: { value: string; label: string }[];
  filterAllLabel?: string;
  onSearchChange: (q: string) => void;
  onFilterChange: (value: string) => void;
  onClearAll: () => void;
  resultCount: number;
  hasActiveFilters: boolean;
}

// ── Component ──────────────────────────────────────────────────────

export function EventFiltersPanel({
  q,
  filterValue,
  filterLabel = "Event type",
  filterOptions,
  filterAllLabel = "All types",
  onSearchChange,
  onFilterChange,
  onClearAll,
  resultCount,
  hasActiveFilters,
}: EventFiltersPanelProps) {
  return (
    <Card aria-label="Event filters" className="bg-card/30 border-border/30">
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle\u2026"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search events"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">{filterLabel}</div>
          <Select
            value={filterValue || null}
            onValueChange={(v) => onFilterChange(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => {
                  if (!v) return filterAllLabel;
                  const opt = filterOptions.find((o) => o.value === v);
                  return opt?.label ?? v;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>
                  {filterAllLabel}
                </SelectItem>
                {filterOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <>
            <Separator className="sm:col-span-2" />
            <div className="flex items-center justify-center gap-2 sm:col-span-2">
              <Badge variant="secondary">{resultCount} results</Badge>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onClearAll}
              >
                Clear filters
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
