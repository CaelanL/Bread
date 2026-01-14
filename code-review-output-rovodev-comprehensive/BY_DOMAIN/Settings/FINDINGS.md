[STATUS: review_done_needs_followup]

# Settings Domain Review

## Summary
The Settings domain is well-designed and relatively simple with minimal critical issues. The color scheme system is elegant and centralized. However, there are concerns around preference validation, extensibility for future settings, syncing across devices, and error handling during preference changes.

---

## Critical Issues

### 1. No Validation of Preference Values
**File:** `lib/store/index.ts` (setColorMode, setBibleVersion)
**Severity:** MEDIUM
**Issue:**
- `setColorMode()` and `setBibleVersion()` accept any string without validation
- User could set invalid values via developer tools or API manipulation
- No type checking at runtime despite TypeScript types

**Impact:**
- Invalid theme could crash app or show broken colors
- Invalid Bible version causes silent failures later

**Suggested Fix:**
```typescript
const VALID_COLOR_MODES = new Set<ColorMode>(['light', 'dark', 'system']);
const VALID_BIBLE_VERSIONS = new Set<BibleVersion>(['ESV', 'NLT', 'KJV']);

export async function setColorMode(mode: ColorMode): Promise<void> {
  if (!VALID_COLOR_MODES.has(mode)) {
    throw new Error(`Invalid color mode: ${mode}`);
  }
  set({ colorMode: mode });
  try {
    await AsyncStorage.setItem(COLOR_MODE_KEY, mode);
  } catch (e) {
    console.error('[STORE] Failed to save colorMode:', e);
    throw e;
  }
}

export async function setBibleVersion(version: BibleVersion): Promise<void> {
  if (!VALID_BIBLE_VERSIONS.has(version)) {
    throw new Error(`Invalid Bible version: ${version}`);
  }
  set({ bibleVersion: version });
  try {
    await AsyncStorage.setItem(BIBLE_VERSION_KEY, version);
  } catch (e) {
    console.error('[STORE] Failed to save bibleVersion:', e);
    throw e;
  }
}
```

**Ticket:** Create task: "Add runtime validation for preference values"

---

### 2. No Error Handling When Preferences Fail to Save
**File:** `lib/store/index.ts` (lines ~314-330)
**Severity:** MEDIUM
**Issue:**
```typescript
setColorMode: async (mode: ColorMode) => {
  set({ colorMode: mode });
  try {
    await AsyncStorage.setItem(COLOR_MODE_KEY, mode);
  } catch (e) {
    console.error('[STORE] Failed to save colorMode:', e);
    // ← Silently continues, UI already updated
  }
},
```
- Sets state before persisting to storage
- If AsyncStorage fails (disk full, permissions), state is inconsistent with storage
- On app restart, preference reverts to old value
- User doesn't know preference wasn't saved

**Impact:**
- Preference changes appear to work but revert on restart
- User confusion and frustration
- Data inconsistency

**Suggested Fix:**
```typescript
setColorMode: async (mode: ColorMode) => {
  const previousMode = get().colorMode;
  
  try {
    // Validate first
    if (!VALID_COLOR_MODES.has(mode)) {
      throw new Error(`Invalid color mode: ${mode}`);
    }
    
    // Update state optimistically
    set({ colorMode: mode });
    
    // Persist to storage
    try {
      await AsyncStorage.setItem(COLOR_MODE_KEY, mode);
    } catch (storageError) {
      // Revert on failure
      set({ colorMode: previousMode });
      set({ error: 'Failed to save theme preference' });
      throw storageError;
    }
  } catch (e) {
    console.error('[STORE] Color mode change failed:', e);
    throw e;
  }
}
```

**Ticket:** Create task: "Add preference save error handling with rollback"

---

## Code Quality Issues

### 1. Sign Out Missing Error Handling
**File:** `app/(tabs)/settings.tsx` (lines ~142-146)
**Severity:** MEDIUM
**Issue:**
```typescript
const handleSignOut = async () => {
  setSigningOut(true);
  await signOut();
  setSigningOut(false);
  // No error handling if signOut fails
};
```
- If signOut fails, user stuck in loading state
- No error message shown to user
- UI appears broken (button disabled indefinitely)

**Impact:**
- Poor UX if signout fails
- User can't retry or understand what went wrong

**Suggested Fix:**
```typescript
const [signOutError, setSignOutError] = React.useState<string | null>(null);

const handleSignOut = async () => {
  setSigningOut(true);
  setSignOutError(null);
  
  try {
    await signOut();
    // Navigation handled by auth context
  } catch (error) {
    console.error('[SETTINGS] Sign out failed:', error);
    setSignOutError(error instanceof Error ? error.message : 'Failed to sign out');
    setSigningOut(false);
  }
};

// Show error in UI
{signOutError && (
  <View style={[styles.errorBanner, { backgroundColor: colors.error + '20' }]}>
    <Text style={[styles.errorText, { color: colors.error }]}>
      {signOutError}
    </Text>
  </View>
)}
```

**Ticket:** Create task: "Add error handling to sign out flow"

---

### 2. Bible Version Picker Has No Search/Filter
**File:** `app/(tabs)/settings.tsx` (lines ~139-150)
**Severity:** LOW
**Issue:**
- Only 3 versions now, but if we add more, picker becomes unwieldy
- No search or filter capability
- No ability to preview translations before selecting

**Impact:**
- Poor UX if versions grow beyond 5-10
- Hard to find specific version in long list

**Suggested Fix:**
```typescript
// Support searchable picker for future extensibility
interface BibleVersionPickerProps {
  value: BibleVersion;
  onChange: (value: BibleVersion) => void;
  searchable?: boolean;
}

function BibleVersionPicker({ value, onChange, searchable = false }: BibleVersionPickerProps) {
  const [search, setSearch] = React.useState('');
  
  const filteredVersions = BIBLE_VERSIONS.filter(v =>
    v.full.toLowerCase().includes(search.toLowerCase())
  );
  
  return (
    <View>
      {searchable && (
        <TextInput
          placeholder="Search versions..."
          value={search}
          onChangeText={setSearch}
        />
      )}
      {filteredVersions.map(version => (
        <Pressable key={version.value} onPress={() => onChange(version.value)}>
          <Text>{version.full}</Text>
        </Pressable>
      ))}
    </View>
  );
}
```

**Ticket:** Create task: "Add searchable Bible version picker for scalability"

---

## Future-Proofing Issues

### 1. No Support for Additional Preferences
**File:** All settings files
**Severity:** HIGH
**Issue:**
- Only supports colorMode and bibleVersion (hardcoded)
- Adding new preference requires changes in:
  - `lib/store/index.ts` (state, actions, hydration)
  - `app/(tabs)/settings.tsx` (UI)
  - `lib/storage` (persistence)
  - `AsyncStorage` keys (hardcoded)
- Can't easily add: font size, reading speed, notification prefs, language, etc.

**Impact:**
- Feature requests require large refactoring
- Hard to onboard new preferences
- Settings screen becomes monolithic

**Suggested Fix:**
Design extensible preference system:
```typescript
// Define preferences as composable objects
interface PreferenceDefinition<T = any> {
  key: string;
  defaultValue: T;
  validate?: (value: any) => boolean;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

const PREFERENCES = {
  colorMode: {
    key: 'color_mode',
    defaultValue: 'system' as ColorMode,
    validate: (v) => ['light', 'dark', 'system'].includes(v),
  } as PreferenceDefinition<ColorMode>,
  
  bibleVersion: {
    key: 'bible_version',
    defaultValue: 'ESV' as BibleVersion,
    validate: (v) => ['ESV', 'NLT', 'KJV'].includes(v),
  } as PreferenceDefinition<BibleVersion>,
  
  fontSize: {
    key: 'font_size',
    defaultValue: 16,
    validate: (v) => v >= 12 && v <= 24,
  } as PreferenceDefinition<number>,
};

// Generic preference management
export const usePreference = <T = any>(prefKey: string) => {
  const pref = PREFERENCES[prefKey as keyof typeof PREFERENCES];
  if (!pref) throw new Error(`Unknown preference: ${prefKey}`);
  
  const [value, setValue] = useState<T>(pref.defaultValue);
  
  const updatePreference = async (newValue: T) => {
    if (pref.validate && !pref.validate(newValue)) {
      throw new Error(`Invalid value for ${prefKey}`);
    }
    
    setValue(newValue);
    const serialized = pref.serialize ? pref.serialize(newValue) : String(newValue);
    await AsyncStorage.setItem(pref.key, serialized);
  };
  
  return { value, updatePreference };
};

// Register new preferences at runtime
export function registerPreference<T>(def: PreferenceDefinition<T>) {
  PREFERENCES[def.key] = def;
}
```

**Ticket:** Create task: "Design extensible preference system"

---

### 2. No Device Sync for Preferences
**File:** All settings files
**Severity:** MEDIUM
**Issue:**
- Preferences stored locally only
- If user logs in on another device, preferences don't follow
- Each device starts with defaults

**Impact:**
- Poor cross-device experience
- Users must reconfigure on each device
- Limits enterprise/premium features

**Suggested Fix:**
```typescript
// Store preferences in Supabase user metadata or separate table
export async function syncPreferencesFromServer(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  
  // Get preferences from server
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  if (data) {
    // Update local store and AsyncStorage
    set({
      colorMode: data.color_mode || 'system',
      bibleVersion: data.bible_version || 'ESV',
    });
  }
}

export async function syncPreferencesToServer(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  
  const state = get();
  
  await supabase
    .from('user_preferences')
    .upsert({
      user_id: user.id,
      color_mode: state.colorMode,
      bible_version: state.bibleVersion,
      updated_at: new Date().toISOString(),
    });
}
```

**Ticket:** Create task: "Add server-side preference storage for device sync"

---

### 3. No Support for Preference Profiles or Presets
**File:** All settings files
**Severity:** LOW
**Issue:**
- Can't save multiple preference sets
- Can't have reading profile vs. study profile
- Can't export/import settings

**Impact:**
- Limited customization options
- Users can't quickly switch between preference sets

**Suggested Fix:**
```typescript
// Support preference profiles
interface PreferenceProfile {
  id: string;
  name: string;
  preferences: Record<string, any>;
  isDefault: boolean;
}

export const usePreferenceProfiles = create<{
  profiles: PreferenceProfile[];
  activeProfile: string;
  createProfile: (name: string, prefs: Record<string, any>) => Promise<void>;
  switchProfile: (id: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
}>((set) => ({
  // Implementation
}));
```

**Ticket:** Create task: "Add preference profiles feature"

---

## Performance Issues

### 1. Color Scheme Hook Recalculates on Every Render
**File:** `hooks/use-color-scheme.ts` (lines ~3-11)
**Severity:** LOW
**Issue:**
```typescript
export function useColorScheme() {
  const systemScheme = useSystemColorScheme(); // Recalculates every render
  const colorMode = useAppStore((state) => state.colorMode);

  if (colorMode === 'system') {
    return systemScheme; // Conditional logic runs every render
  }
  return colorMode;
}
```
- Recalculates on every render
- Used in hundreds of components
- Simple calculation but adds up with scale

**Impact:**
- Marginal performance hit
- Unnecessary re-renders in deeply nested components

**Suggested Fix:**
```typescript
export function useColorScheme() {
  const systemScheme = useSystemColorScheme();
  const colorMode = useAppStore((state) => state.colorMode);
  
  // Memoize result
  return useMemo(() => {
    if (colorMode === 'system') {
      return systemScheme;
    }
    return colorMode;
  }, [systemScheme, colorMode]);
}
```

**Ticket:** Create task: "Memoize useColorScheme result"

---

### 2. Theme Object Not Memoized in Components
**File:** `app/(tabs)/settings.tsx`, many others
**Severity:** LOW
**Issue:**
```typescript
const colorScheme = useColorScheme();
const colors = Colors[colorScheme ?? 'light']; // Creates new reference every render
```
- `colors` object created fresh every render even if colorScheme hasn't changed
- Passed as prop to child components causing unnecessary re-renders

**Impact:**
- Marginal performance hit but multiplied across many screens

**Suggested Fix:**
```typescript
// Memoize color selection
const colors = useMemo(() => 
  Colors[colorScheme ?? 'light'], 
  [colorScheme]
);
```

**Ticket:** Create task: "Memoize theme color selection in components"

---

## Scale Issues

### 1. No Rate Limiting on Preference Changes
**File:** `lib/store/index.ts`
**Severity:** LOW
**Issue:**
- User could change color mode hundreds of times per second
- Each change writes to AsyncStorage and updates state
- Could cause performance issues at scale

**Impact:**
- Rapid clicks could lag app
- AsyncStorage write queue backs up

**Suggested Fix:**
```typescript
const setColorMode = useMemo(() => {
  let pendingTimeout: NodeJS.Timeout | null = null;
  
  return async (mode: ColorMode) => {
    if (pendingTimeout) clearTimeout(pendingTimeout);
    
    set({ colorMode: mode });
    
    pendingTimeout = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(COLOR_MODE_KEY, mode);
      } catch (e) {
        console.error('[STORE] Failed to save colorMode:', e);
      }
      pendingTimeout = null;
    }, 500); // Debounce writes
  };
}, []);
```

**Ticket:** Create task: "Add debouncing to preference change persistence"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Add runtime validation for preference values | MEDIUM | Quality |
| Add preference save error handling with rollback | MEDIUM | Reliability |
| Add error handling to sign out flow | MEDIUM | Error Handling |
| Add searchable Bible version picker for scalability | LOW | Future-Proofing |
| Design extensible preference system | HIGH | Future-Proofing |
| Add server-side preference storage for device sync | MEDIUM | Future-Proofing |
| Add preference profiles feature | LOW | Future-Proofing |
| Memoize useColorScheme result | LOW | Performance |
| Memoize theme color selection in components | LOW | Performance |
| Add debouncing to preference change persistence | LOW | Scale |

---

## Next Review Section
→ Continue with: `BY_DOMAIN/Bible-Data`
