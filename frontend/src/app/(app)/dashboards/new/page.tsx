"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mutate as revalidate } from "swr";
import { useApi } from "@/hooks/useApi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type DashboardResponse = components["schemas"]["DashboardResponse"];

export default function NewDashboardPage() {
  const api = useApi();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.post<DashboardResponse>("/dashboards", { name: name.trim() });
      void revalidate("/dashboards");
      router.push(`/dashboards/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't create this dashboard.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex max-w-sm flex-col gap-4">
      <PageHeader title="New dashboard" back={{ href: "/dashboards", label: "Dashboards" }} />

      <Card>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Name
            <Input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Greenhouse overview"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-status-error">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" size="md" disabled={submitting}>
              {submitting ? "Creating…" : "Create dashboard"}
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={() => router.push("/dashboards")}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
