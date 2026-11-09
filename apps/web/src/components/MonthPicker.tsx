interface MonthPickerProps {
  months: string[];
  value: string;
  onChange: (month: string) => void;
}

/** A controlled select: the parent owns the value, and this only reports the user's choice. */
export function MonthPicker({ months, value, onChange }: MonthPickerProps) {
  // Include a month from the URL that isn't imported, so the select still shows what's selected.
  const options = months.includes(value) ? months : [...months, value];

  return (
    <label className="month-picker">
      Month{" "}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {[...options].sort().reverse().map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </select>
    </label>
  );
}
