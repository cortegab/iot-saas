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
import { marketingCopy } from "@/lib/marketing-copy";
import { useLocale } from "@/lib/i18n";

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
  const c = marketingCopy(useLocale());
  const k = c.talk;

  useEffect(() => {
    if (open) {
      setDeploy(deployment);
      setSent(false);
      setError(null);
      setTouched(false);
    }
  }, [open, deployment]);

  const problem = !name.trim()
    ? { field: "name", text: k.needName }
    : !EMAIL.test(email.trim())
      ? { field: "email", text: k.needEmail }
      : !company.trim()
        ? { field: "company", text: k.needCompany }
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
      setError(err instanceof ApiRequestError ? err.message : k.failed);
    } finally {
      setBusy(false);
    }
  }

  const err = (f: string) => (touched && problem?.field === f ? problem.text : null);

  if (sent) {
    return (
      <Dialog open={open} onClose={onClose} title={k.thanks} footer={<Button onClick={onClose}>{k.close}</Button>}>
        <p className="flex gap-2.5 text-sm text-ink">
          <CheckCircle2 aria-hidden size={18} className="mt-0.5 shrink-0 text-status-online" />
          {k.replyTo.replace("{email}", email.trim())}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={k.title}
      description={k.description}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {k.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? k.sending : k.send}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label={k.name} error={err("name")}>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={k.email} error={err("email")}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={k.company} error={err("company")}>
          <Input autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label={k.interested}>
          <Select value={deploy} onChange={(e) => setDeploy(e.target.value as Deployment)}>
            <option value="cloud">{c.deployment.options.cloud.name}</option>
            <option value="dedicated">{c.deployment.options.dedicated.name}</option>
            <option value="on_prem">{c.deployment.options.on_prem.name}</option>
            <option value="not_sure">{k.notSure}</option>
          </Select>
        </Field>
        <Field label={k.devices}>
          <Select value={devices} onChange={(e) => setDevices(e.target.value)}>
            <option value="<100">{k.sizes[0]}</option>
            <option value="100-500">{k.sizes[1]}</option>
            <option value="500-1000">{k.sizes[2]}</option>
            <option value=">1000">{k.sizes[3]}</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label={k.else} optional>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={k.elsePlaceholder} />
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
