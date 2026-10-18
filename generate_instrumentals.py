"""Generate six ORIGINAL short instrumental compositions for Blooming Hands.
Standard library + NumPy; requires ffmpeg to encode MP3.
These tracks are not samples, covers, or derivatives of commercial recordings.
"""
import math, os, subprocess
from pathlib import Path
import numpy as np

OUT = Path(__file__).resolve().parent / 'assets' / 'tracks'
OUT.mkdir(parents=True,exist_ok=True)
SR=24000
rng=np.random.default_rng(417)

# Harmonic, envelope-shaped generated instruments. Input MIDI note number.
def note_hz(note):return 440.0*2**((note-69)/12)
def add_tone(mix, time, midi, duration, vol, kind='keys', pan=0.0):
    start=int(time*SR)
    if start>=len(mix):return
    count=min(int((duration + .23)*SR),len(mix)-start)
    if count<=0:return
    t=np.arange(count,dtype=np.float32)/SR
    freq=note_hz(midi)
    attack=np.minimum(1.,t/(.008 if kind not in ['pad','strings'] else .33))
    release=np.minimum(1.,np.maximum(0,duration+.20-t)/(.16 if kind not in ['pad','strings'] else .48))
    if kind=='keys':
        env=np.exp(-1.5*t/max(duration,.18))*attack*release
        tone=np.sin(2*np.pi*freq*t)+.36*np.sin(2*np.pi*freq*2*t)*np.exp(-t*3)+.13*np.sin(2*np.pi*freq*3*t)*np.exp(-t*5)
    elif kind=='bell':
        env=np.exp(-2.5*t/max(duration,.2))*attack*release
        tone=np.sin(2*np.pi*freq*t)+.46*np.sin(2*np.pi*freq*2.01*t)*np.exp(-t*6)+.18*np.sin(2*np.pi*freq*3.97*t)*np.exp(-t*7)
    elif kind=='pluck':
        env=np.exp(-3.2*t/max(duration,.18))*attack*release
        tone=np.sin(2*np.pi*freq*t)+.45*np.sin(2*np.pi*freq*2*t)+.16*np.sin(2*np.pi*freq*4*t)
    elif kind=='bass':
        env=np.exp(-.8*t/max(duration,.2))*attack*release
        tone=np.sin(2*np.pi*freq*t)+.22*np.sin(2*np.pi*freq*2*t)
    elif kind=='pad':
        env=attack*release*(.7+.3*np.sin(np.pi*np.minimum(1,t/max(duration,.5))))
        tone=np.sin(2*np.pi*freq*t)+.31*np.sin(2*np.pi*(freq*1.003)*t)+.15*np.sin(2*np.pi*freq*2*t)
    elif kind=='strings':
        env=attack*release
        tone=np.sin(2*np.pi*freq*t)+.27*np.sin(2*np.pi*freq*2*t)+.18*np.sin(2*np.pi*freq*3*t)
        tone *= (.91+.09*np.sin(2*np.pi*5.1*t))
    else:
        env=attack*release
        tone=np.sin(2*np.pi*freq*t)
    tone=(tone*env*vol).astype(np.float32)
    mix[start:start+count,0]+=tone*(.8-pan*.23)
    mix[start:start+count,1]+=tone*(.8+pan*.23)

def add_drum(mix, time, kind, vol):
    start=int(time*SR)
    length={'kick':.38,'snare':.23,'hat':.13,'tick':.08}[kind]
    count=min(int(length*SR),len(mix)-start)
    if count<=0:return
    t=np.arange(count,dtype=np.float32)/SR
    if kind=='kick':
        phase=2*np.pi*(63*t+35*(1-np.exp(-t*40))/40)
        snd=np.sin(phase)*np.exp(-t*19)
    elif kind=='snare':
        noise=rng.normal(0,1,count).astype('float32')
        snd=(noise*.77+np.sin(2*np.pi*190*t)*.22)*np.exp(-t*24)
    else:
        noise=rng.normal(0,1,count).astype('float32')
        snd=np.concatenate(([0],np.diff(noise)))*np.exp(-t*(45 if kind=='hat' else 75))
    v=vol*snd.astype('float32')
    mix[start:start+count,0]+=v*.75
    mix[start:start+count,1]+=v*.75

# Original patterns: roots/chord voices and melody in MIDI scale; no existing commercial song melodies.
SONGS=[
 dict(file='01-blooming-garden.mp3', title='Blooming Garden', bpm=98, chords=[[53,57,60,64],[48,52,55,59],[50,53,57,60],[46,50,53,57]],
      melody=[69,72,76,72,69,67,65,69,72,74,72,69,67,65,64,65], lead='bell', pad='pad', drum='soft', seed=2),
 dict(file='02-neon-sunset.mp3', title='Neon Sunset', bpm=116, chords=[[48,52,55,59],[43,47,50,54],[45,48,52,55],[41,45,48,52]],
      melody=[76,79,76,72,74,76,79,81,79,76,74,72,71,72,74,76], lead='pluck',pad='strings',drum='pop',seed=5),
 dict(file='03-moonlit-coffee.mp3', title='Moonlit Coffee', bpm=84, chords=[[57,60,64,67],[53,57,60,64],[50,53,57,60],[52,56,59,62]],
      melody=[76,74,72,69,72,76,79,76,74,72,69,67,69,72,74,72], lead='keys',pad='pad',drum='lofi',seed=7),
 dict(file='04-peach-disco.mp3', title='Peach Disco', bpm=122, chords=[[55,59,62,66],[52,55,59,62],[48,52,55,59],[50,54,57,60]],
      melody=[79,81,83,86,83,81,79,76,78,81,83,81,79,78,76,74], lead='pluck',pad='strings',drum='dance',seed=11),
 dict(file='05-cloud-nine.mp3', title='Cloud Nine', bpm=76, chords=[[51,55,58,62],[46,50,53,57],[55,58,62,65],[48,51,55,58]],
      melody=[74,77,79,77,74,72,70,72,74,77,82,79,77,74,72,70], lead='bell',pad='pad',drum='ambient',seed=13),
 dict(file='06-morning-pixels.mp3', title='Morning Pixels', bpm=128, chords=[[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,65]],
      melody=[84,83,79,76,79,83,84,88,86,84,81,79,76,79,81,83], lead='pluck',pad='pad',drum='pop',seed=17)
]

def make_song(spec):
    beat=60/spec['bpm']
    bars=16
    duration=bars*4*beat
    mix=np.zeros((int((duration+.15)*SR),2),dtype=np.float32)
    for bar in range(bars):
        begin=bar*4*beat
        chord=spec['chords'][bar%4]
        for i,n in enumerate(chord):
            add_tone(mix, begin, n, beat*4.0, .052 if spec['drum']!='ambient' else .085, spec['pad'], pan=(i-1.5)*.38)
        add_tone(mix,begin,chord[0]-12,beat*1.7,.115,'bass')
        add_tone(mix,begin+2*beat,chord[0]-12,beat*1.55,.092,'bass')
        for step in range(8):
            tick=begin+step*beat/2
            mi=spec['melody'][(bar*4+step)%len(spec['melody'])]
            # Rest on selected offbeats: phrasing and rhythmic variation.
            if (bar+step)%7==0: continue
            add_tone(mix,tick,mi,beat*(.68 if step%2 else .85),.085 if spec['lead']=='bell' else .067,spec['lead'],pan=((step%4)-1.5)*.25)
            if spec['drum']!='ambient' and step%2==1:
                add_tone(mix,tick,chord[(step//2)%4]+12,beat*.30,.027,'pluck',pan=(-1)**step*.5)
        for b in range(4):
            t=begin+b*beat
            d=spec['drum']
            if d!='ambient':
                if (b%2==0 or d=='dance'):
                    add_drum(mix,t,'kick',.11 if d=='lofi' else .16)
                if b in (1,3):
                    add_drum(mix,t,'snare',.052 if d in ('soft','lofi') else .074)
                for h in range(2):
                    add_drum(mix,t+h*beat/2,'hat',.017 if d=='soft' else .026)
            elif b==0 and bar%2==0: add_drum(mix,t,'tick',.018)
    # Gentle room reverb via delays (no recorded samples).
    original=mix.copy()
    for delay,amount in [(.12,.13),(.23,.085),(.37,.055)]:
        s=int(SR*delay)
        mix[s:]+=original[:-s]*amount
    peak=np.max(np.abs(mix))
    mix*=min(1.0,.92/max(peak,1e-5))
    fade=int(SR*.16)
    mix[:fade]*=np.linspace(0,1,fade)[:,None]
    mix[-fade:]*=np.linspace(1,0,fade)[:,None]
    # Produce WAV directly, encode compact AAC-free universal MP3.
    raw=(mix*32767).astype('<i2').tobytes()
    target=OUT/spec['file']
    p=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','s16le','-ar',str(SR),'-ac','2','-i','pipe:0','-codec:a','libmp3lame','-b:a','112k',str(target)],input=raw,capture_output=True)
    if p.returncode!=0:raise RuntimeError(p.stderr.decode()[:500])
    print(spec['title'],round(duration,1),'seconds', round(target.stat().st_size/1024),'KB')

if __name__=='__main__':
    for song in SONGS:make_song(song)
