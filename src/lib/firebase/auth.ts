import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  browserLocalPersistence,
  setPersistence,
  type User,
} from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getClientAuth, getClientDb } from "./config";
import type { UserDoc } from "@/lib/shared/types";

const googleProvider = new GoogleAuthProvider();

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<User> {
  const auth = getClientAuth();
  const db = getClientDb();

  await setPersistence(auth, browserLocalPersistence);
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName });

  const userDoc: Omit<UserDoc, "createdAt" | "lastLoginAt"> & {
    createdAt: ReturnType<typeof serverTimestamp>;
    lastLoginAt: ReturnType<typeof serverTimestamp>;
  } = {
    uid: user.uid,
    email: user.email!,
    displayName,
    role: "user",
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
    isDisabled: false,
  };

  await setDoc(doc(db, "users", user.uid), userDoc);
  return user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const auth = getClientAuth();
  const db = getClientDb();

  await setPersistence(auth, browserLocalPersistence);
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  await updateDoc(doc(db, "users", user.uid), {
    lastLoginAt: serverTimestamp(),
  });
  return user;
}

export async function signInWithGoogle(): Promise<User> {
  const auth = getClientAuth();
  const db = getClientDb();

  await setPersistence(auth, browserLocalPersistence);
  const { user } = await signInWithPopup(auth, googleProvider);

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || "User",
      role: "user",
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
      isDisabled: false,
    });
  } else {
    await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
  }

  return user;
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(getClientAuth());
}

export function onAuthStateChanged(callback: (user: User | null) => void) {
  return firebaseOnAuthStateChanged(getClientAuth(), callback);
}

export async function getUserRole(user: User): Promise<"user" | "admin"> {
  const tokenResult = await user.getIdTokenResult();
  return (tokenResult.claims.role as "admin" | "user") || "user";
}
