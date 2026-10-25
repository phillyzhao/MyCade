// Classic ten-pin scoring for N frames. rolls: number[] of pins per ball.
export function scoreFrames(rolls, nFrames) {
  const frames = [];
  let i = 0;
  let total = 0;
  for (let f = 0; f < nFrames; f++) {
    const last = f === nFrames - 1;
    const r1 = rolls[i];
    if (r1 === undefined) {
      frames.push({ balls: [], total: null });
      continue;
    }
    if (!last) {
      if (r1 === 10) {
        const b1 = rolls[i + 1];
        const b2 = rolls[i + 2];
        const done = b1 !== undefined && b2 !== undefined;
        total += done ? 10 + b1 + b2 : 0;
        frames.push({ balls: ['X'], total: done ? total : null, strike: true });
        i += 1;
      } else {
        const r2 = rolls[i + 1];
        if (r2 === undefined) {
          frames.push({ balls: [mark(r1)], total: null });
          i += 1;
          continue;
        }
        if (r1 + r2 === 10) {
          const b = rolls[i + 2];
          total += b !== undefined ? 10 + b : 0;
          frames.push({ balls: [mark(r1), '/'], total: b !== undefined ? total : null, spare: true });
        } else {
          total += r1 + r2;
          frames.push({ balls: [mark(r1), mark(r2)], total });
        }
        i += 2;
      }
    } else {
      // last frame: up to 3 balls
      const b = rolls.slice(i, i + 3);
      const balls = [];
      let standing = 10;
      b.forEach((v, k) => {
        if (v === 10 && standing === 10) {
          balls.push('X');
          standing = 10;
        } else if (k > 0 && standing < 10 && v === standing) {
          balls.push('/');
          standing = 10;
        } else {
          balls.push(mark(v));
          standing = standing - v === 0 ? 10 : standing - v;
        }
      });
      const done = lastFrameDone(b);
      if (done) total += b.reduce((a, c) => a + c, 0);
      frames.push({ balls, total: done ? total : null });
      i += b.length;
    }
  }
  const running = frames.reduce((acc, fr) => (fr.total != null ? fr.total : acc), 0);
  return { frames, total: running };
}

function mark(v) {
  return v === 0 ? '-' : String(v);
}

export function lastFrameDone(b) {
  if (b.length < 2) return false;
  if (b.length === 3) return true;
  return b[0] + b[1] < 10; // open frame ends after 2
}

/** Is the current player's frame complete given the rolls in this frame? */
export function frameDone(frameRolls, isLast) {
  if (isLast) return lastFrameDone(frameRolls);
  return frameRolls[0] === 10 || frameRolls.length === 2;
}

/** Pins standing before the next ball of this frame (to know whether to reset the rack). */
export function needsFreshRack(frameRolls, isLast) {
  if (frameRolls.length === 0) return true;
  if (!isLast) return false;
  // last frame: fresh rack after a strike or a spare
  if (frameRolls.length === 1) return frameRolls[0] === 10;
  if (frameRolls.length === 2) return frameRolls[0] === 10 ? frameRolls[1] === 10 || false : frameRolls[0] + frameRolls[1] === 10;
  return false;
}
