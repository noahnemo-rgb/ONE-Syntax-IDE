import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import {
  GitHubConfig,
  githubPat,
  loadGitHubConfig,
  loadWebhookConfig,
  hideSecret,
  pushToGitHub,
  pushToWebhook,
  saveGitHubConfig,
  saveWebhookConfig,
  shareViaNative,
  WebhookConfig,
  webhookToken,
} from "@/src/lib/push";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

export function PushModal({
  visible,
  filename,
  language,
  content,
  onClose,
}: {
  visible: boolean;
  filename: string;
  language: string;
  content: string;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<"github" | "webhook" | "share">("github");

  // GitHub state
  const [pat, setPat] = useState<string>("");
  const [patHint, setPatHint] = useState<string>("");
  const [patLoaded, setPatLoaded] = useState<boolean>(false);
  const [gh, setGh] = useState<GitHubConfig>({ owner: "", repo: "", branch: "main", path: "" });
  const [ghMsg, setGhMsg] = useState<string>(`Update ${filename} from Syntax`);

  // Webhook state
  const [wh, setWh] = useState<WebhookConfig>({ url: "" });
  const [whToken, setWhToken] = useState<string>("");
  const [whHint, setWhHint] = useState<string>("");
  const [whTokenLoaded, setWhTokenLoaded] = useState<boolean>(false);

  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const [patHintValue, ghCfg, whCfg, whHintValue] = await Promise.all([
        githubPat.hint(),
        loadGitHubConfig(),
        loadWebhookConfig(),
        webhookToken.hint(),
      ]);
      setPat("");
      setPatHint(patHintValue);
      setPatLoaded(Boolean(patHintValue));
      if (ghCfg) setGh(ghCfg);
      if (whCfg) setWh(whCfg);
      setWhToken("");
      setWhHint(whHintValue);
      setWhTokenLoaded(Boolean(whHintValue));
      setStatus(null);
      setGhMsg(`Update ${filename} from Syntax`);
    })();
  }, [visible, filename]);

  const doGitHub = async () => {
    setStatus(null);
    if (!gh.owner.trim() || !gh.repo.trim() || !gh.branch.trim() || !gh.path.trim()) {
      return setStatus({ ok: false, text: "Owner, repo, branch, and path are all required." });
    }
    setBusy(true);
    const typed = pat.trim();
    const token = typed || (await githubPat.get()) || "";
    if (!token) {
      setBusy(false);
      return setStatus({ ok: false, text: "Enter a GitHub Personal Access Token." });
    }
    try {
      if (typed) await githubPat.set(typed);
      await saveGitHubConfig(gh);
      const res = await pushToGitHub({
        pat: token,
        owner: gh.owner.trim(),
        repo: gh.repo.trim(),
        branch: gh.branch.trim(),
        path: gh.path.trim(),
        message: ghMsg.trim() || `Update ${filename}`,
        content,
      });
      setPat("");
      const hint = await githubPat.hint();
      setPatHint(hint);
      setPatLoaded(Boolean(hint));
      setStatus({ ok: true, text: `Pushed. commit ${res.commitSha.slice(0, 7)}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ ok: false, text: hideSecret(msg, token) });
    } finally {
      setBusy(false);
    }
  };

  const doWebhook = async () => {
    setStatus(null);
    if (!wh.url.trim()) return setStatus({ ok: false, text: "Webhook URL is required." });
    setBusy(true);
    try {
      await saveWebhookConfig(wh);
      const typedToken = whToken.trim();
      if (typedToken) await webhookToken.set(typedToken);
      const token = typedToken || (await webhookToken.get()) || "";
      const res = await pushToWebhook({
        url: wh.url.trim(),
        token: token || undefined,
        filename,
        language,
        content,
      });
      setWhToken("");
      const hint = await webhookToken.hint();
      setWhHint(hint);
      setWhTokenLoaded(Boolean(hint));
      setStatus({ ok: true, text: `Webhook accepted (HTTP ${res.status}).` });
    } catch (e) {
      const typedToken = whToken.trim();
      const token = typedToken || (await webhookToken.get()) || "";
      setStatus({ ok: false, text: hideSecret(e instanceof Error ? e.message : String(e), token) });
    } finally {
      setBusy(false);
    }
  };

  const doShare = async () => {
    setStatus(null);
    setBusy(true);
    try {
      const r = await shareViaNative({ filename, content });
      if (r.kind === "share") setStatus({ ok: true, text: "Share sheet opened." });
      else if (r.kind === "clipboard") setStatus({ ok: true, text: r.message });
      else setStatus({ ok: true, text: "Share cancelled." });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[s.backdrop, { height }]}
      >
        <View style={s.sheet} testID="push-modal">
          <View style={s.head}>
            <Text style={s.title}>Push</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="push-close">
              <Feather name="x" size={20} color={COLORS.onSurface} />
            </Pressable>
          </View>
          <View style={s.tabs}>
            {[
              { k: "github", label: "GitHub", icon: "github" as const },
              { k: "webhook", label: "Webhook", icon: "server" as const },
              { k: "share", label: "Share", icon: "share-2" as const },
            ].map((t) => (
              <Pressable
                key={t.k}
                onPress={() => setTab(t.k as "github" | "webhook" | "share")}
                style={[s.tab, tab === t.k && s.tabActive]}
                testID={`push-tab-${t.k}`}
              >
                <Feather name={t.icon} size={14} color={tab === t.k ? COLORS.brand : COLORS.onSurfaceSecondary} />
                <Text style={[s.tabLabel, tab === t.k && { color: COLORS.brand }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {tab === "github" ? (
              <>
                <Field label={patLoaded ? "GitHub PAT (saved on device)" : "GitHub PAT"}>
                  <TextInput
                    value={pat}
                    onChangeText={setPat}
                    placeholder="ghp_… or github_pat_…"
                    placeholderTextColor={COLORS.onSurfaceSecondary}
                    style={s.input}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="push-pat"
                  />
                  {patHint ? (
                    <Text style={s.hint} testID="push-pat-hint">
                      {patHint}
                    </Text>
                  ) : null}
                  {Platform.OS === "web" ? null : (
                    <Text style={s.hint}>Stored in the OS Keychain. Never sent to our servers.</Text>
                  )}
                </Field>
                <Row>
                  <Field label="Owner" flex={1}>
                    <TextInput value={gh.owner} onChangeText={(v) => setGh({ ...gh, owner: v })} placeholder="octocat" placeholderTextColor={COLORS.onSurfaceSecondary} style={s.input} autoCapitalize="none" testID="push-owner" />
                  </Field>
                  <Field label="Repo" flex={1}>
                    <TextInput value={gh.repo} onChangeText={(v) => setGh({ ...gh, repo: v })} placeholder="hello-world" placeholderTextColor={COLORS.onSurfaceSecondary} style={s.input} autoCapitalize="none" testID="push-repo" />
                  </Field>
                </Row>
                <Row>
                  <Field label="Branch" flex={1}>
                    <TextInput value={gh.branch} onChangeText={(v) => setGh({ ...gh, branch: v })} placeholder="main" placeholderTextColor={COLORS.onSurfaceSecondary} style={s.input} autoCapitalize="none" testID="push-branch" />
                  </Field>
                  <Field label="Path" flex={2}>
                    <TextInput value={gh.path} onChangeText={(v) => setGh({ ...gh, path: v })} placeholder={`src/${filename}`} placeholderTextColor={COLORS.onSurfaceSecondary} style={s.input} autoCapitalize="none" testID="push-path" />
                  </Field>
                </Row>
                <Field label="Commit message">
                  <TextInput value={ghMsg} onChangeText={setGhMsg} style={s.input} testID="push-message" />
                </Field>
                <Pressable onPress={doGitHub} disabled={busy} style={[s.primary, busy && { opacity: 0.5 }]} testID="push-github-btn">
                  {busy ? <ActivityIndicator size="small" color={COLORS.onBrand} /> : <Text style={s.primaryLabel}>Push to GitHub</Text>}
                </Pressable>
                {patLoaded ? (
                  <Pressable
                    onPress={async () => {
                      await githubPat.clear();
                      setPat("");
                      setPatHint("");
                      setPatLoaded(false);
                      setStatus({ ok: true, text: "GitHub token cleared from this device." });
                    }}
                    style={s.secondary}
                    testID="push-clear-pat"
                  >
                    <Text style={s.secondaryLabel}>Clear stored token</Text>
                  </Pressable>
                ) : null}
              </>
            ) : tab === "webhook" ? (
              <>
                <Field label="Webhook URL (HTTPS)">
                  <TextInput
                    value={wh.url}
                    onChangeText={(v) => setWh({ url: v })}
                    placeholder="https://example.com/hook"
                    placeholderTextColor={COLORS.onSurfaceSecondary}
                    style={s.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="push-webhook-url"
                  />
                </Field>
                <Field label={whTokenLoaded ? "Bearer token (saved on device)" : "Bearer token (optional)"}>
                  <TextInput
                    value={whToken}
                    onChangeText={setWhToken}
                    placeholder="secret"
                    placeholderTextColor={COLORS.onSurfaceSecondary}
                    style={s.input}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="push-webhook-token"
                  />
                  {whHint ? (
                    <Pressable
                      onLongPress={async () => {
                        await webhookToken.clear();
                        setWhToken("");
                        setWhHint("");
                        setWhTokenLoaded(false);
                      }}
                    >
                      <Text style={s.hint} testID="push-webhook-hint">
                        {whHint}
                      </Text>
                    </Pressable>
                  ) : null}
                </Field>
                <Text style={s.hint}>Body: {"{ filename, language, content, timestamp }"}</Text>
                <Pressable onPress={doWebhook} disabled={busy} style={[s.primary, busy && { opacity: 0.5 }]} testID="push-webhook-btn">
                  {busy ? <ActivityIndicator size="small" color={COLORS.onBrand} /> : <Text style={s.primaryLabel}>POST to server</Text>}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={s.hint}>Send this file via the OS share sheet — AirDrop, Nearby Share, Messages, Mail, and any other app that accepts text/files.</Text>
                <Pressable onPress={doShare} disabled={busy} style={[s.primary, busy && { opacity: 0.5 }]} testID="push-share-btn">
                  {busy ? <ActivityIndicator size="small" color={COLORS.onBrand} /> : <Text style={s.primaryLabel}>Open Share sheet</Text>}
                </Pressable>
              </>
            )}
            {status ? (
              <Text style={[s.status, status.ok ? { color: COLORS.success } : { color: COLORS.error }]} testID="push-status">
                {status.text}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: number }) {
  return (
    <View style={{ gap: SPACING.xs, flex }}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: SPACING.sm }}>{children}</View>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: RADIUS.lg * 1.5, borderTopRightRadius: RADIUS.lg * 1.5, borderWidth: 1, borderColor: COLORS.border, maxHeight: "92%" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  tabs: { flexDirection: "row", padding: 3, margin: SPACING.md, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.xs, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm },
  tabActive: { backgroundColor: COLORS.brandTertiary },
  tabLabel: { color: COLORS.onSurface, fontSize: TEXT.sm, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  body: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl },
  label: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  input: { backgroundColor: COLORS.surfaceSecondary, color: COLORS.onSurface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, fontSize: TEXT.base, fontFamily: FONT.mono },
  hint: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm - 1, lineHeight: 18 },
  primary: { backgroundColor: COLORS.brand, paddingVertical: SPACING.md, borderRadius: RADIUS.md, alignItems: "center", marginTop: SPACING.sm },
  primaryLabel: { color: COLORS.onBrand, fontWeight: "700", fontSize: TEXT.base },
  secondary: { paddingVertical: SPACING.sm, alignItems: "center" },
  secondaryLabel: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm },
  status: { fontFamily: FONT.mono, fontSize: TEXT.sm, marginTop: SPACING.sm },
});
