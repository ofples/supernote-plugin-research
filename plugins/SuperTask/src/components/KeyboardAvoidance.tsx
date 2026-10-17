import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  ScrollView,
  UIManager,
  View,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type ViewStyle,
} from 'react-native';

type KeyboardFrame = {screenY: number};
type ViewportFrame = {top: number; height: number};
type FocusedInputFrame = {top: number; height: number};

/** Return only the part of a keyboard that covers this window's bottom edge. */
export function calculateKeyboardInset(viewport: ViewportFrame, keyboard: KeyboardFrame | null): number {
  if (!keyboard || !Number.isFinite(viewport.top) || !Number.isFinite(viewport.height) || !Number.isFinite(keyboard.screenY)) return 0;
  return Math.max(0, Math.min(viewport.height, viewport.top + viewport.height - keyboard.screenY));
}

/** Move only enough to expose a focused field inside the part of the scroll view above the keyboard. */
export function calculateFocusedInputScrollDelta(
  viewport: ViewportFrame & {scrollY: number},
  input: FocusedInputFrame,
  keyboard: KeyboardFrame | null,
  gap = 16,
): number {
  const visibleTop = viewport.top;
  const visibleBottom = Math.min(viewport.top + viewport.height, keyboard?.screenY ?? Number.POSITIVE_INFINITY);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  if (visibleHeight === 0 || !Number.isFinite(input.top) || !Number.isFinite(input.height)) return 0;

  // A multiline field can be taller than the usable viewport. Keep its lower
  // edge (where the insertion point usually is) visible while it is edited.
  if (input.height + gap * 2 > visibleHeight) {
    return input.top + input.height - (visibleBottom - gap);
  }
  if (input.top < visibleTop + gap) return input.top - (visibleTop + gap);
  if (input.top + input.height > visibleBottom - gap) return input.top + input.height - (visibleBottom - gap);
  return 0;
}

/** Subscribe to the events that change the visible keyboard frame. */
export function subscribeToKeyboardFrames(
  keyboard: typeof Keyboard,
  dimensions: typeof Dimensions,
  onShow: (frame: KeyboardFrame) => void,
  onHide: () => void,
  onWindowChange: () => void,
): () => void {
  const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
  const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
  const show = keyboard.addListener(showEvent, event => onShow(event.endCoordinates));
  const hide = keyboard.addListener(hideEvent, onHide);
  const resize = dimensions.addEventListener('change', onWindowChange);
  return () => {
    show.remove();
    hide.remove();
    resize.remove();
  };
}

type KeyboardAvoidanceViewportProps = React.PropsWithChildren<{
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  accessibilityLabel?: string;
}>;

/** Shrinks to the visible area above the keyboard, accounting for host-window offsets and adjustResize. */
export function KeyboardAvoidanceViewport({children, style, contentStyle, accessibilityLabel}: KeyboardAvoidanceViewportProps) {
  const frameRef = useRef<ViewportFrame>({top: 0, height: 0});
  const windowRef = useRef<View>(null);
  const mounted = useRef(true);
  const [frame, setFrame] = useState<ViewportFrame>(frameRef.current);
  const [keyboard, setKeyboard] = useState<KeyboardFrame | null>(() => Keyboard.metrics() || null);

  const measureTop = useCallback(() => {
    if (!mounted.current) return;
    windowRef.current?.measureInWindow((_x, top) => {
      if (!mounted.current) return;
      const next = {...frameRef.current, top};
      frameRef.current = next;
      setFrame(next);
    });
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = {...frameRef.current, height: event.nativeEvent.layout.height};
    frameRef.current = next;
    setFrame(next);
    measureTop();
  }, [measureTop]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeToKeyboardFrames(
      Keyboard,
      Dimensions,
      next => {setKeyboard(next); measureTop();},
      () => setKeyboard(null),
      () => {
        const metrics = Keyboard.metrics();
        setKeyboard(metrics || null);
        measureTop();
      },
    );
    return () => {mounted.current = false; unsubscribe();};
  }, [measureTop]);

  const inset = calculateKeyboardInset(frame, keyboard);
  return <View ref={windowRef} onLayout={onLayout} accessibilityLabel={accessibilityLabel} style={[{flex: 1, overflow: 'hidden'}, style]}>
    <View style={[{flex: 1}, contentStyle, inset > 0 && {height: Math.max(0, frame.height - inset), flex: 0}]}>
      {children}
    </View>
  </View>;
}

export function focusedInputTarget(event: any): number | null {
  const target = event?.nativeEvent?.target ?? event?.target;
  return typeof target === 'number' ? target : null;
}

export function revealFocusedInput(
  scrollView: {scrollTo?: (options: {y: number; animated: boolean}) => void},
  currentOffset: number,
  viewport: ViewportFrame,
  input: FocusedInputFrame,
  keyboard: KeyboardFrame | null,
): number {
  const delta = calculateFocusedInputScrollDelta({...viewport, scrollY: currentOffset}, input, keyboard);
  if (Math.abs(delta) > 1) scrollView.scrollTo?.({y: Math.max(0, currentOffset + delta), animated: false});
  return delta;
}

/** Vertical form lists explicitly reveal their focused input when the keyboard opens. */
type KeyboardAwareScrollViewProps = ScrollViewProps & {
  onFocus?: (event: any) => void;
  onBlur?: (event: any) => void;
};

export function KeyboardAwareScrollView({onFocus, onBlur, keyboardShouldPersistTaps = 'handled', ...props}: KeyboardAwareScrollViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const focusedTarget = useRef<number | null>(null);
  const mounted = useRef(true);
  const viewportRef = useRef<ViewportFrame>({top: 0, height: 0});
  const currentOffset = useRef(0);
  const keyboardFrame = useRef<KeyboardFrame | null>(Keyboard.metrics() || null);
  const NativeScrollView: any = ScrollView;
  const measure = useCallback((target = focusedTarget.current) => {
    if (!mounted.current) return;
    const view = scrollRef.current as any;
    if (target == null || !view?.measureInWindow || !UIManager.measureInWindow) return;
    view.measureInWindow((_x: number, top: number, width: number, height: number) => {
      // Inactive navigation routes stay mounted with display:none. Their
      // native frames are empty, so don't let a keyboard event scroll them.
      if (!mounted.current || width <= 0 || height <= 0) return;
      viewportRef.current = {top, height};
      UIManager.measureInWindow(target, (_inputX: number, inputTop: number, _inputWidth: number, inputHeight: number) => {
        if (!mounted.current || focusedTarget.current !== target) return;
        revealFocusedInput(view, currentOffset.current, viewportRef.current, {top: inputTop, height: inputHeight}, keyboardFrame.current);
      });
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(showEvent, event => {
      keyboardFrame.current = event.endCoordinates;
      requestAnimationFrame(() => measure());
    });
    const hidden = Keyboard.addListener(hideEvent, () => {keyboardFrame.current = null;});
    const resize = Dimensions.addEventListener('change', () => {
      keyboardFrame.current = Keyboard.metrics() || null;
      requestAnimationFrame(() => measure());
    });
    return () => {mounted.current = false; shown.remove(); hidden.remove(); resize.remove();};
  }, [measure]);

  return <NativeScrollView
    {...props}
    ref={scrollRef}
    keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    onFocus={(event: any) => {
      focusedTarget.current = focusedInputTarget(event);
      onFocus?.(event);
      if (Keyboard.isVisible()) requestAnimationFrame(() => measure());
    }}
    onBlur={(event: any) => {
      const target = focusedInputTarget(event);
      if (target == null || focusedTarget.current === target) focusedTarget.current = null;
      onBlur?.(event);
    }}
    onLayout={(event: any) => {
      viewportRef.current = {...viewportRef.current, height: event.nativeEvent.layout.height};
      props.onLayout?.(event);
      requestAnimationFrame(() => measure());
    }}
    onScroll={(event: any) => {
      currentOffset.current = event.nativeEvent.contentOffset.y;
      props.onScroll?.(event);
    }}
    onContentSizeChange={(width: number, height: number) => {
      props.onContentSizeChange?.(width, height);
      if (keyboardFrame.current) requestAnimationFrame(() => measure());
    }}
    scrollEventThrottle={props.scrollEventThrottle ?? 16}
  />;
}
