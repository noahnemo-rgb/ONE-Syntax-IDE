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
import type { DashboardRow, KeyedProviderId } from "ai-buffer";

import { isPuterSignedIn, signInAiProvider } from "@/src/lib/ai-chat";
import { keyStoreFor, loadSyntaxDashboard, providerSelection } from "@/src/lib/ai-keys";
import { COLORS, FONT, RADIUS, SPACING, TEXT } from "@/src/theme";

const KEYED = new Set<string>(["openrouter", "space-bunny", "vercel-gateway", "gemini", "nvidia", "llmapi"]);

export function AiSettingsModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [models, setModels] = useState<Record<string, string>>({});
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  const refresh = async () => {
    const signedIn = Platform.OS === "web" ? await isPuterSignedIn() : false;
    const next = await loadSyntaxDashboard(signedIn);
    setRows(next);
    setModels(Object.fromEntries(next.map((row) => [row.id, row.model])));
  };

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const signedIn = Platform.OS === "web" ? await isPuterSignedIn() : false;
        const next = await loadSyntaxDashboard(signedIn);
        if (cancelled) return;
        setRows(next);
        setModels(Object.fromEntries(next.map((row) => [row.id, row.model])));
        setKeyDrafts({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const choose = async (row: DashboardRow) => {
    await providerSelection().setProvider(row.id);
    if (row.id === "puter" && Platform.OS === "web" && !row.configured) {
      try {
        await signInAiProvider();
      } catch {
        // Sign-in failure has no approved dashboard string.
      }
    }
    await refresh();
    onSaved?.();
  };

  const commitModel = async (row: DashboardRow) => {
    const value = models[row.id] ?? "";
    try {
      await providerSelection().setModel(row.id, value);
    } catch {
      // A key pasted into the model field is rejected. No approved error string.
    }
    await refresh();
    onSaved?.();
  };

  const commitKey = async (row: DashboardRow) => {
    if (!KEYED.has(row.id)) return;
    const value = (keyDrafts[row.id] ?? "").trim();
    if (!value) return;
    await keyStoreFor(row.id as KeyedProviderId).setKey(value);
    setKeyDrafts((drafts) => ({ ...drafts, [row.id]: "" }));
    await refresh();
    onSaved?.();
  };

  const clearKey = async (row: DashboardRow) => {
    if (!KEYED.has(row.id) || !row.keyHint) return;
    await keyStoreFor(row.id as KeyedProviderId).clearKey();
    setKeyDrafts((drafts) => ({ ...drafts, [row.id]: "" }));
    await refresh();
    onSaved?.();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
        <View style={[styles.sheet, { maxHeight: height * 0.88 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>ai-buffer</Text>
            <Pressable onPress={onClose} hitSlop={8} testID="ai-settings-close">
              <Feather name="x" size={22} color={COLORS.onSurfaceSecondary} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color={COLORS.brand} style={{ marginVertical: SPACING.xl }} />
          ) : (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {rows.map((row) => {
                const active = Boolean(row.activeLabel);
                return (
                  <View
                    key={row.id}
                    style={[styles.row, active && styles.rowActive]}
                    testID={`ai-provider-row-${row.id}`}
                  >
                    <Pressable
                      onPress={() => void choose(row)}
                      testID={row.id === "puter" ? "ai-puter-signin-btn" : `ai-provider-${row.id}`}
                    >
                      <Text style={styles.provider}>{row.label}</Text>
                    </Pressable>
                    <Text style={styles.meta}>{row.status}</Text>
                    <Pressable onLongPress={() => void clearKey(row)} disabled={!row.keyHint}>
                      <Text style={styles.meta} testID={`ai-key-hint-${row.id}`}>
                        {row.keyHint}
                      </Text>
                    </Pressable>
                    <Text style={styles.meta}>{row.activeLabel}</Text>
                    <View style={styles.modelLine}>
                      <Text style={styles.meta}>{row.modelLabel}</Text>
                      <TextInput
                        value={models[row.id] ?? ""}
                        onChangeText={(value) => setModels((current) => ({ ...current, [row.id]: value }))}
                        onEndEditing={() => void commitModel(row)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel={row.modelLabel}
                        style={[styles.input, styles.modelInput]}
                        testID={row.id === "openrouter" ? "ai-openrouter-model" : `ai-model-${row.id}`}
                      />
                    </View>
                    {KEYED.has(row.id) ? (
                      <TextInput
                        value={keyDrafts[row.id] ?? ""}
                        onChangeText={(value) => setKeyDrafts((current) => ({ ...current, [row.id]: value }))}
                        onEndEditing={() => void commitKey(row)}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={styles.input}
                        testID={row.id === "openrouter" ? "ai-openrouter-key" : `ai-key-${row.id}`}
                      />
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheetWrap: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingBottom: SPACING.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  title: { color: COLORS.onSurface, fontSize: TEXT.lg, fontWeight: "700" },
  body: { padding: SPACING.lg, gap: SPACING.sm },
  row: {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  rowActive: { borderColor: COLORS.brand },
  provider: { color: COLORS.onSurface, fontSize: TEXT.base, fontWeight: "700" },
  meta: { color: COLORS.onSurfaceSecondary, fontSize: TEXT.sm },
  modelLine: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.onSurface,
    fontFamily: FONT.mono,
    fontSize: TEXT.sm,
  },
  modelInput: { flex: 1 },
});
