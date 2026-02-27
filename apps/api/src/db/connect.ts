import mongoose from "mongoose";
import { env } from "../config/env.js";

let isConnected = false;

export async function connectDatabase() {
  if (isConnected) {
    return;
  }

  await mongoose.connect(env.MONGODB_URI, {
    dbName: "shop_with_seye",
    serverSelectionTimeoutMS: 15000,
    tls: true,
    family: 4
  });
  isConnected = true;
}

export async function disconnectDatabase() {
  if (!isConnected) {
    return;
  }
  await mongoose.disconnect();
  isConnected = false;
}
