"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { ApiRequestError, apiClient } from "@/lib/api-client";

export type Deployment = "cloud" | "dedicated" | "on_prem" | "not_sure";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Talk to us" (demo G deployment section): emails the team through
 * POST /public/contact. Nothing is stored. A hidden `website` field is the
 * honeypot — people never see it, bots fill it in. */
export function TalkToUsDialog({ open, onClose, deployment }: { open: boolean; onClose: () => void; deployment: Deployment }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [deploy, setDeploy] = useState<Deployment>(deployment);
  const [devices, setDevices] = useState("100-500");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) {
      setDeploy(deployment);
      setSent(false);
      setError(null);
      setTouched(false);
    }
  }, [open, deployment]);

  const problem = !name.trim()
    ? { field: "name", text: "Tell us your name." }
    : !EMAIL.test(email.trim())
      ? { field: "email", text: "Enter a work email we can reply to." }
      : !company.trim()
        ? { field: "company", text: "Which company or site is this for?" }
        : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post("/public/contact", {}, { name: name.trim(), email: email.trim(), company: company.trim(), deployment: deploy, devices, message: message.trim(), website });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't send it. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const err = (f: string) => (touched && problem?.field === f ? problem.text : null);

  if (sent) {
    return (
      <Dialog open={open} onClose={onClose} title="Thanks, we've got it" footer={<Button onClick={onClose}>Close</Button>}>
        <p className="flex gap-2.5 text-sm text-ink">
          <CheckCircle2 aria-hidden size={18} className="mt-0.5 shrink-0 text-status-online" />
          We reply within one working day, to {email.trim()}.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Talk to us about deployment"
      description="Tell us a little about your sites. We reply within one working day."
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Name" error={err("name")}>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Work email" error={err("email")}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Company or site" error={err("company")}>
          <Input autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Interested in">
          <Select value={deploy} onChange={(e) => setDeploy(e.target.value as Deployment)}>
            <option value="cloud">Cloud</option>
            <option value="dedicated">Dedicated cloud</option>
            <option value="on_prem">On-premise</option>
            <option value="not_sure">Not sure yet</option>
          </Select>
        </Field>
        <Field label="Devices, roughly">
          <Select value={devices} onChange={(e) => setDevices(e.target.value)}>
            <option value="<100">Fewer than 100</option>
            <option value="100-500">100 to 500</option>
            <option value="500-1000">500 to 1,000</option>
            <option value=">1000">More than 1,000</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Anything else" optional>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Sites, equipment (OPC UA, Modbus…), network constraints" />
          </Field>
        </div>
        {/* Honeypot: off-screen and out of the tab order. */}
        <label className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-status-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
