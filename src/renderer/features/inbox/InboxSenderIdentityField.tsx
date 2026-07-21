import { AtSign } from "lucide-react";
import { senderIdentityStyle } from "./sender-identity";

interface InboxSenderIdentityFieldProps {
  addresses: string[];
  disabled?: boolean;
  error?: string | null;
  onChange: (address: string) => void;
  value: string;
}

export function InboxSenderIdentityField({
  addresses,
  disabled = false,
  error,
  onChange,
  value,
}: InboxSenderIdentityFieldProps) {
  return (
    <label className="inbox-sender-field">
      <span>Enviar como</span>
      <span
        className="inbox-sender-field__control"
        style={senderIdentityStyle(value)}
      >
        <span className="inbox-sender-field__mark">
          <AtSign aria-hidden="true" size={13} />
        </span>
        <select
          aria-label="Enviar como"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {addresses.map((address, index) => (
            <option key={address} value={address}>
              {address} {index === 0 ? "· principal" : "· alias"}
            </option>
          ))}
        </select>
      </span>
      <small className={error ? "inbox-sender-field__error" : undefined}>
        {error ??
          "O endereço escolhido será conferido novamente antes do envio."}
      </small>
    </label>
  );
}
