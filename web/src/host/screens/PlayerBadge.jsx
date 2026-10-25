import { useHost } from '../store.js';
import { AVATAR_NAME } from '../../brand.js';

export function AvatarHead({ player, size = 56 }) {
  const img = player.avatar?.image;
  return (
    <div className="avatar-head" style={{ '--pc': player.color, width: size, height: size }}>
      {img ? <img src={img} alt="" /> : <span>{(player.name || '?').slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

export default function PlayerBadge({ player, big, score, sub }) {
  const st = player.avatar?.status;
  const status = player.cpu
    ? 'CPU'
    : player.keyboard
      ? 'keyboard'
      : !player.connected
        ? 'reconnecting…'
        : st === 'processing'
          ? `making ${AVATAR_NAME}…`
          : st === 'image'
            ? `${AVATAR_NAME} card ready · 3D cooking`
            : st === 'ready'
              ? `${AVATAR_NAME} ready!`
              : st === 'failed'
                ? 'default look'
                : 'ready';
  return (
    <div className={`pbadge glass ${big ? 'big' : ''} bounce-in`} style={{ '--pc': player.color }}>
      <AvatarHead player={player} size={big ? 64 : 44} />
      <div className="pbadge-text">
        <div className="pname">{player.name}</div>
        <div className="pstatus">{sub ?? status}</div>
      </div>
      {score != null && <div className="pscore">{score}</div>}
      {big && !player.cpu && !player.keyboard ? null : big ? (
        <button className="kick" onClick={() => useHost.getState().removePlayer(player.id)} title="Remove">
          ×
        </button>
      ) : null}
    </div>
  );
}
