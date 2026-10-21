// What a phone signs to approve a link request (decision 0077), the same bytes
// as the core's `link_approval_message`: a label, so it is never an MLS
// signature, then the link id in UTF-8, then the new device's key.

const APPROVAL_LABEL = new TextEncoder().encode("spjall device link v1\0");

/** The bytes a phone signs to approve `linkId` for `deviceKey`. */
export function approvalMessage(linkId: string, deviceKey: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(linkId);
  const message = new Uint8Array(APPROVAL_LABEL.length + id.length + deviceKey.length);
  message.set(APPROVAL_LABEL, 0);
  message.set(id, APPROVAL_LABEL.length);
  message.set(deviceKey, APPROVAL_LABEL.length + id.length);
  return message;
}
