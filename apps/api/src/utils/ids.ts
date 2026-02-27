import { Types } from "mongoose";

export function toObjectId(id: string) {
  if (!Types.ObjectId.isValid(id)) {
    throw new Error("Invalid ObjectId");
  }
  return new Types.ObjectId(id);
}
