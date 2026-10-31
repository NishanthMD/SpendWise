/* The SpendWise mascot: a little bear hugging a rupee coin. Same drawing as public/favicon.svg. */
export default function Logo({ size = 44, className = "" }) {
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="SpendWise bear holding a rupee coin">
      <g stroke="#4a2c17" strokeWidth="2" strokeLinejoin="round">
        <circle cx="17" cy="15" r="7" fill="#c98f5b" />
        <circle cx="47" cy="15" r="7" fill="#c98f5b" />
        <circle cx="17" cy="15" r="3.2" fill="#f6cfa6" stroke="none" />
        <circle cx="47" cy="15" r="3.2" fill="#f6cfa6" stroke="none" />
        <ellipse cx="32" cy="52" rx="17" ry="10" fill="#d9a066" />
        <circle cx="32" cy="29" r="19" fill="#d9a066" />
        <ellipse cx="32" cy="35" rx="8" ry="6" fill="#fbe6c8" stroke="none" />
      </g>
      <ellipse cx="32" cy="32.5" rx="2.6" ry="1.9" fill="#4a2c17" />
      <path d="M29 36 q3 3 6 0" fill="none" stroke="#4a2c17" strokeWidth="1.6" strokeLinecap="round" />
      <g className="logo-eyes">
        <circle cx="24.5" cy="27" r="2.3" fill="#4a2c17" />
        <circle cx="39.5" cy="27" r="2.3" fill="#4a2c17" />
        <circle cx="25.3" cy="26.2" r=".8" fill="#fff" />
        <circle cx="40.3" cy="26.2" r=".8" fill="#fff" />
      </g>
      <circle cx="19.5" cy="33" r="3" fill="#f08a8a" opacity=".55" />
      <circle cx="44.5" cy="33" r="3" fill="#f08a8a" opacity=".55" />
      <g className="logo-coin">
        <circle cx="32" cy="50" r="9.5" fill="#ffc400" stroke="#4a2c17" strokeWidth="2" />
        <circle cx="32" cy="50" r="6.6" fill="none" stroke="#c98a00" strokeWidth="1" />
        <text x="32" y="54" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="700" textAnchor="middle" fill="#7a4a00">₹</text>
      </g>
      <circle cx="21.5" cy="50.5" r="4" fill="#d9a066" stroke="#4a2c17" strokeWidth="2" />
      <circle cx="42.5" cy="50.5" r="4" fill="#d9a066" stroke="#4a2c17" strokeWidth="2" />
    </svg>
  );
}
