import sqlite3
import dash
import pandas as pd
from dash import Dash, html, dcc, Input, Output, State
import dash.dependencies
import os
import base64
import io
from sklearn.preprocessing import StandardScaler
from sklearn.metrics.pairwise import euclidean_distances

# Get the root directory (two levels up from src/analysis/)
root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
db_path = os.path.join(root_dir, 'spotify_music_library.db')
harmonic_rules_path = os.path.join(root_dir, 'data', 'harmonic_mixing_rules.csv')

HARMONIC_RULE_COLUMNS = [
    'Perfect Mix',
    '-1 Mix',
    '+1 Mix',
    'Energy Boost',
    'Scale Change',
    'Diagonal Mix',
    "Jaw's Mix",
    'Mood Shifter'
]

HARMONIC_RULE_GROUPS = {
    'Perfect Mix': 1,
    '-1 Mix': 1,
    '+1 Mix': 1,
    'Energy Boost': 2,
    'Scale Change': 2,
    'Diagonal Mix': 3,
    "Jaw's Mix": 4,
    'Mood Shifter': 5,
}

# Connect to the database
conn = sqlite3.connect(db_path)

# Query artists and songs for KNN dropdowns
df_songs = pd.read_sql("SELECT Song, Artist FROM tracks ORDER BY Song, Artist", conn)
song_options = [{'label': f"{row['Song']} - {row['Artist']}", 'value': f"{row['Artist']}|{row['Song']}"} for _, row in df_songs.iterrows()]

df_keys = pd.read_sql("SELECT DISTINCT Camelot FROM tracks WHERE Camelot IS NOT NULL AND TRIM(Camelot) != ''", conn)

def camelot_sort_value(key_label):
    key_str = str(key_label).strip().upper()
    if len(key_str) >= 2 and key_str[:-1].isdigit() and key_str[-1] in ('A', 'B'):
        return (0, key_str[-1], int(key_str[:-1]))
    return (1, key_str, 999)

key_options = [
    {'label': key, 'value': key}
    for key in sorted(df_keys['Camelot'].dropna().astype(str).unique(), key=camelot_sort_value)
]

conn.close()

df_harmonic_rules = pd.read_csv(harmonic_rules_path)

def build_key_step_lookup(seed_camelot):
    if pd.isna(seed_camelot):
        return {}

    row = df_harmonic_rules[df_harmonic_rules['Starting Key'] == seed_camelot]
    if row.empty:
        return {}

    row = row.iloc[0]
    step_lookup = {}
    for column in HARMONIC_RULE_COLUMNS:
        target_key = row[column]
        if pd.notna(target_key):
            step_lookup[str(target_key)] = HARMONIC_RULE_GROUPS[column]

    return step_lookup

def ensure_custom_playlist_tables(conn):
    """Ensure custom playlist tables exist and have required columns for current output schema."""
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS custom_playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_name TEXT NOT NULL,
            seed_song TEXT NOT NULL,
            seed_artist TEXT NOT NULL,
            year_range INTEGER,
            target_size INTEGER NOT NULL,
            created_date TEXT NOT NULL,
            csv_path TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS custom_playlist_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            track_number INTEGER NOT NULL,
            track_key TEXT NOT NULL,
            track_id TEXT NOT NULL,
            song TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT,
            year INTEGER,
            bpm REAL,
            valence REAL,
            dance REAL,
            energy REAL,
            key TEXT,
            distance REAL,
            mood_score REAL,
            key_step INTEGER,
            FOREIGN KEY (playlist_id) REFERENCES custom_playlists(id) ON DELETE CASCADE
        )
    ''')

    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_custom_playlist_songs_playlist_id
        ON custom_playlist_songs(playlist_id)
    ''')

    existing_cols = {
        row[1] for row in cursor.execute("PRAGMA table_info(custom_playlist_songs)").fetchall()
    }
    required_cols = {
        'bpm': 'REAL',
        'valence': 'REAL',
        'energy': 'REAL',
        'dance': 'REAL',
        'key': 'TEXT',
        'distance': 'REAL',
        'mood_score': 'REAL',
        'key_step': 'INTEGER'
    }

    for col_name, col_type in required_cols.items():
        if col_name not in existing_cols:
            cursor.execute(f"ALTER TABLE custom_playlist_songs ADD COLUMN {col_name} {col_type}")

    conn.commit()

# Create Dash app
app = Dash(__name__)

app.layout = html.Div([
    html.H1("Spotify Playlist Builder"),

    html.H2("Nearest Neighbor Stats"),
    html.Div([
        html.Label("Select Song for Stats:"),
        dcc.Dropdown(
            id='pb-nn-song-dropdown',
            options=song_options,
            value=None,
            placeholder="Search for a song...",
            searchable=True
        ),
    ], style={'marginBottom': '15px'}),
    html.Div([
        html.Button('Show Nearest Neighbor Stats', id='pb-nn-stats-button', n_clicks=0, style={'backgroundColor': '#455A64', 'color': 'white', 'border': 'none', 'padding': '8px 16px'}),
    ], style={'marginBottom': '10px'}),
    html.Div(id='pb-nn-stats', style={'marginBottom': '20px'}),
    
    html.Hr(),
    html.H2("Playlist Builder"),

    html.Div([
        html.Label("Upload CSV Songs (session only):"),
        dcc.Upload(
            id='pb-upload-csv',
            children=html.Button('Upload Playlist CSV', style={'backgroundColor': '#607D8B', 'color': 'white', 'border': 'none', 'padding': '8px 16px'}),
            multiple=False
        ),
        html.Div(id='pb-upload-status', style={'marginTop': '8px'})
    ], style={'marginBottom': '15px'}),
    
    html.Div([
        html.Label("Select Seed Song:"),
        dcc.Dropdown(
            id='pb-song-dropdown',
            options=song_options,
            value=None,
            placeholder="Search for a song...",
            searchable=True
        ),
    ], style={'marginBottom': '15px'}),
    
    html.Div([
        html.Label("Target Playlist Size:"),
        dcc.Input(
            id='pb-target-size',
            type='number',
            value=50,
            min=2,
            max=200,
            step=1,
            style={'width': '150px'}
        ),
    ], style={'marginBottom': '15px'}),
    
    html.Div([
        html.Label("Playlist Name:"),
        dcc.Input(
            id='pb-playlist-name',
            type='text',
            value='',
            placeholder="Auto-generated from seed song...",
            style={'width': '300px'}
        ),
    ], style={'marginBottom': '15px'}),
    
    html.Button('Start Playlist Builder', id='pb-start-button', n_clicks=0, style={'marginBottom': '20px'}),
    html.Div(id='pb-seed-stats', style={'marginBottom': '15px'}),
    
    html.Div(id='pb-current-song', style={'marginBottom': '20px'}),
    
    html.Div([
        html.Button('Previous 10 Songs', id='pb-prev-batch-button', n_clicks=0, disabled=True, style={'display': 'none', 'marginRight': '10px', 'backgroundColor': '#546E7A', 'color': 'white', 'border': 'none', 'padding': '10px 20px'}),
        html.Button('Next 10 Songs', id='pb-next-batch-button', n_clicks=0, disabled=True, style={'display': 'none', 'backgroundColor': '#607D8B', 'color': 'white', 'border': 'none', 'padding': '10px 20px'}),
    ], style={'marginBottom': '20px'}),

    html.Div(id='pb-progress', style={'marginBottom': '20px', 'fontSize': '18px'}),

    html.Div([
        html.Button('Export Playlist to CSV', id='pb-export-button', n_clicks=0, disabled=True, style={'marginRight': '10px', 'backgroundColor': '#2196F3', 'color': 'white', 'border': 'none', 'padding': '10px 20px'}),
        html.Button('Save to Database', id='pb-save-db-button', n_clicks=0, disabled=True, style={'backgroundColor': '#9C27B0', 'color': 'white', 'border': 'none', 'padding': '10px 20px'}),
    ], style={'marginBottom': '20px'}),
    html.Div(id='pb-save-status', style={'marginBottom': '20px', 'fontSize': '18px', 'color': 'green'}),
    dcc.Download(id='pb-download'),

    html.Div(id='pb-playlist'),

    html.Hr(),
    html.H2("Songs by Key"),
    html.Div([
        html.Label("Select Key:"),
        dcc.Dropdown(
            id='pb-key-dropdown',
            options=key_options,
            value=None,
            placeholder="Select a Camelot key...",
            searchable=True,
            style={'width': '300px'}
        ),
    ], style={'marginBottom': '15px'}),
    html.Div(id='pb-key-results', style={'marginBottom': '20px'}),
    
    dcc.Store(id='pb-knn-results'),
    dcc.Store(id='pb-current-index'),
    dcc.Store(id='pb-accepted-songs'),
    dcc.Store(id='pb-rejected-songs'),
    dcc.Store(id='pb-uploaded-songs')
])

@app.callback(
    Output('pb-knn-results', 'data'),
    Output('pb-current-index', 'data'),
    Output('pb-accepted-songs', 'data'),
    Output('pb-rejected-songs', 'data'),
    Output('pb-seed-stats', 'children'),
    Input('pb-start-button', 'n_clicks'),
    State('pb-song-dropdown', 'value'),
    State('pb-uploaded-songs', 'data'),
    prevent_initial_call=True
)
def start_playlist_builder(n_clicks, selected_song_artist, uploaded_songs_data):
    if n_clicks == 0 or not selected_song_artist:
        return None, 0, [], [], html.Div()
    
    try:
        selected_artist, selected_song = selected_song_artist.split('|')
        
        conn = sqlite3.connect(db_path)
        ensure_custom_playlist_tables(conn)
        
        df_metadata = pd.read_sql("""
            SELECT Track_Key, Track_ID, Song, Artist, Album, Album_Year, Popularity, Camelot,
                   BPM, Valence, Dance, Energy
            FROM tracks
            WHERE Album_Year IS NOT NULL
        """, conn)
        conn.close()
        
        df_metadata = df_metadata.set_index('Track_Key')
        df_metadata['Source'] = 'Database'

        if uploaded_songs_data:
            df_uploaded = pd.DataFrame(uploaded_songs_data)
            if not df_uploaded.empty:
                expected_cols = [
                    'Track_Key', 'Track_ID', 'Song', 'Artist', 'Album', 'Album_Year', 'Popularity',
                    'Camelot', 'BPM', 'Valence', 'Dance', 'Energy', 'Source'
                ]
                for col in expected_cols:
                    if col not in df_uploaded.columns:
                        df_uploaded[col] = None

                numeric_cols = ['BPM', 'Valence', 'Dance', 'Energy', 'Album_Year', 'Popularity']
                for col in numeric_cols:
                    df_uploaded[col] = pd.to_numeric(df_uploaded[col], errors='coerce')

                df_uploaded = df_uploaded.dropna(subset=['Track_Key', 'Song', 'Artist', 'BPM', 'Valence', 'Dance', 'Energy'])
                df_uploaded = df_uploaded.set_index('Track_Key')
                df_uploaded['Source'] = 'Uploaded CSV'

                df_uploaded = df_uploaded[df_metadata.columns.intersection(df_uploaded.columns)]
                df_uploaded = df_uploaded.reindex(columns=df_metadata.columns)

                df_metadata = pd.concat([df_metadata, df_uploaded], axis=0)
                df_metadata = df_metadata[~df_metadata.index.duplicated(keep='first')]

        df_features = df_metadata[['BPM', 'Valence', 'Dance', 'Energy']].copy()
        
        # Add Track_Key back as a column for filtering
        df_metadata['Track_Key'] = df_metadata.index
        
        seed_key = f"{selected_artist}|{selected_song}"
        if seed_key not in df_metadata.index:
            return None, 0, [], [], html.Div("Seed song not found in tracks table.", style={'color': '#f44336'})
        
        seed_row = df_metadata.loc[seed_key]
        seed_camelot = seed_row['Camelot']
        seed_mood_score = seed_row['Valence'] + seed_row['Dance'] + seed_row['Energy']
        key_step_lookup = build_key_step_lookup(seed_camelot)
        default_key_step = len(HARMONIC_RULE_GROUPS) + 1
        seed_key_step = key_step_lookup.get(str(seed_camelot), 1)

        # Prepare seed song stats for display
        seed_stats = [
            html.H4("Seed Song Stats", style={'marginBottom': '8px'}),
            html.P(f"0. {seed_row['Song']} — {seed_row['Artist']} ({seed_row['Album_Year']}) [ORIGINAL]", style={'fontWeight': 'bold', 'fontSize': '18px'}),
            html.P(f"   Distance: 0.0000"),
            html.P(f"   Features: BPM={seed_row['BPM']}, Mood Score={seed_mood_score:.1f}, Key Step={seed_key_step}"),
            html.P(f"   Core Features: BPM={seed_row['BPM']}, Valence={seed_row['Valence']}, Energy={seed_row['Energy']}, Dance={seed_row['Dance']}, Key={seed_camelot}")
        ]

        df_mood_scores = df_features[['Valence', 'Dance', 'Energy']].sum(axis=1)
        df_key_steps = df_metadata['Camelot'].apply(lambda k: key_step_lookup.get(str(k), default_key_step))
        df_metadata['mood_score'] = df_mood_scores
        df_metadata['key_step'] = df_key_steps

        df_distance_features = pd.DataFrame({
            'BPM': df_features['BPM'],
            'Mood_Score': df_mood_scores,
            'Key_Step': df_key_steps
        }, index=df_features.index)

        scaler = StandardScaler()
        df_distance_scaled = scaler.fit_transform(df_distance_features)

        seed_distance_df = pd.DataFrame([{
            'BPM': seed_row['BPM'],
            'Mood_Score': seed_mood_score,
            'Key_Step': seed_key_step
        }])
        seed_distance_scaled = scaler.transform(seed_distance_df)[0]

        distances = euclidean_distances([seed_distance_scaled], df_distance_scaled)[0]
        df_metadata['distance'] = distances
        df_metadata = df_metadata.sort_values('distance')
        df_metadata = df_metadata[df_metadata.index != seed_key]

        # Cap candidates to distance <= 3
        df_metadata = df_metadata[df_metadata['distance'] <= 3]
        
        # Convert to dict for storage
        knn_results = df_metadata.to_dict('records')

        # Normalize Track_Key so dynamic button IDs are always stable/valid
        for song in knn_results:
            track_key = song.get('Track_Key')
            if pd.isna(track_key) or track_key is None or str(track_key).strip() == '':
                song['Track_Key'] = f"{song.get('Artist', '')}|{song.get('Song', '')}"
            else:
                song['Track_Key'] = str(track_key)

        return knn_results, 0, [], [], html.Div(seed_stats)
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return None, 0, [], [], html.Div(f"Error: {e}", style={'color': '#f44336'})

@app.callback(
    Output('pb-playlist-name', 'value'),
    Input('pb-song-dropdown', 'value')
)
def update_playlist_name(selected_song_artist):
    if not selected_song_artist:
        return ''
    seed_artist, seed_song = selected_song_artist.split('|')
    # Generate default playlist name: "Snap Out Of It"
    return seed_song

@app.callback(
    Output('pb-nn-stats', 'children', allow_duplicate=True),
    Input('pb-nn-stats-button', 'n_clicks'),
    State('pb-nn-song-dropdown', 'value'),
    prevent_initial_call=True
)
def show_nn_stats(n_clicks, selected_song_artist):
    if not selected_song_artist:
        return html.Div("Select a seed song first.", style={'color': '#f44336'})

    try:
        selected_artist, selected_song = selected_song_artist.split('|')
        seed_key = f"{selected_artist}|{selected_song}"

        conn = sqlite3.connect(db_path)
        df_metadata = pd.read_sql("""
            SELECT Track_Key, Song, Artist, Album_Year, Camelot,
                   BPM, Valence, Dance, Energy
            FROM tracks
            WHERE Album_Year IS NOT NULL
        """, conn)
        df_metadata = df_metadata.set_index('Track_Key')

        if seed_key not in df_metadata.index:
            conn.close()
            return html.Div("Seed song not found in tracks table.", style={'color': '#f44336'})

        seed_row = df_metadata.loc[seed_key]
        seed_camelot = seed_row['Camelot']
        key_step_lookup = build_key_step_lookup(seed_camelot)
        default_key_step = len(HARMONIC_RULE_GROUPS) + 1
        seed_mood_score = seed_row['Valence'] + seed_row['Dance'] + seed_row['Energy']

        df_features = df_metadata[['BPM', 'Valence', 'Dance', 'Energy']].copy()
        df_mood_scores = df_features[['Valence', 'Dance', 'Energy']].sum(axis=1)
        df_key_steps = df_metadata['Camelot'].apply(lambda k: key_step_lookup.get(str(k), default_key_step))

        df_distance_features = pd.DataFrame({
            'BPM': df_features['BPM'],
            'Mood_Score': df_mood_scores,
            'Key_Step': df_key_steps
        }, index=df_metadata.index)

        scaler = StandardScaler()
        df_distance_scaled = scaler.fit_transform(df_distance_features)

        seed_distance_df = pd.DataFrame([{
            'BPM': seed_row['BPM'],
            'Mood_Score': seed_mood_score,
            'Key_Step': key_step_lookup.get(str(seed_camelot), 1)
        }])
        seed_distance_scaled = scaler.transform(seed_distance_df)[0]

        distances = euclidean_distances([seed_distance_scaled], df_distance_scaled)[0]

        df_neighbors = df_metadata.copy()
        df_neighbors['distance'] = distances
        df_neighbors['mood_score'] = df_mood_scores
        neighbors = df_neighbors[df_neighbors.index != seed_key].sort_values('distance').head(3)

        conn.close()

        stats_children = [
            html.P(
                f"0. {seed_row['Song']} — {seed_row['Artist']} ({seed_row['Album_Year']})",
                style={'fontWeight': 'bold', 'fontSize': '18px', 'marginBottom': '6px'}
            ),
            html.P(f"Features: BPM={seed_row['BPM']}, Valence={seed_row['Valence']}, Energy={seed_row['Energy']}, Dance={seed_row['Dance']}, Key={seed_camelot}, Mood Score={seed_mood_score:.1f}"),
        ]

        if not neighbors.empty:
            stats_children.append(html.Hr())
            stats_children.append(html.H4("3 Nearest Songs", style={'marginBottom': '8px'}))
            for i, (_, row) in enumerate(neighbors.iterrows(), start=1):
                stats_children.append(
                    html.P(
                        f"{i}. {row['Song']} — {row['Artist']} ({row['Album_Year']})",
                        style={'fontWeight': 'bold', 'fontSize': '16px', 'marginBottom': '4px'}
                    )
                )
                stats_children.append(html.P(f"Distance: {row['distance']:.4f}"))
                stats_children.append(
                    html.P(
                        f"Features: BPM={row['BPM']}, Valence={row['Valence']}, Energy={row['Energy']}, Dance={row['Dance']}, Key={row['Camelot']}, Mood Score={row['mood_score']:.1f}",
                        style={'marginBottom': '8px'}
                    )
                )

        return html.Div(stats_children, style={'backgroundColor': '#f5f5f5', 'padding': '10px', 'borderRadius': '6px'})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return html.Div(f"Error calculating nearest neighbor stats: {str(e)}", style={'color': '#f44336'})

@app.callback(
    Output('pb-current-song', 'children'),
    Output('pb-prev-batch-button', 'disabled'),
    Output('pb-next-batch-button', 'disabled'),
    Output('pb-prev-batch-button', 'style'),
    Output('pb-next-batch-button', 'style'),
    Input('pb-knn-results', 'data'),
    Input('pb-current-index', 'data'),
    Input('pb-accepted-songs', 'data'),
    Input('pb-rejected-songs', 'data'),
    Input('pb-target-size', 'value')
)
def update_current_song(knn_results, current_index, accepted_songs, rejected_songs, target_size):
    prev_style_visible = {'marginRight': '10px', 'backgroundColor': '#546E7A', 'color': 'white', 'border': 'none', 'padding': '10px 20px'}
    next_style_visible = {'backgroundColor': '#607D8B', 'color': 'white', 'border': 'none', 'padding': '10px 20px'}
    hidden_style = {'display': 'none'}

    if not knn_results:
        return html.Div("Select a seed song and click 'Start Playlist Builder' to begin."), True, True, hidden_style, hidden_style

    if accepted_songs is None:
        accepted_songs = []
    if rejected_songs is None:
        rejected_songs = []
    
    current_count = 1 + len(accepted_songs) if accepted_songs else 1
    if current_count >= target_size:
        return html.H3("Playlist Complete!"), True, True, hidden_style, hidden_style
    
    if current_index >= len(knn_results):
        prev_disabled = current_index <= 0
        prev_style = prev_style_visible if current_index > 0 else hidden_style
        return html.H3("No more songs available!"), prev_disabled, True, prev_style, hidden_style
    
    batch_end = min(current_index + 10, len(knn_results))
    current_batch = knn_results[current_index:batch_end]

    batch_html = [
        html.H3(f"Candidate Songs {current_index + 1}-{batch_end}"),
        html.P("Select songs in any order from this batch.", style={'fontStyle': 'italic'})
    ]

    accepted_keys = set(song.get('Track_Key', f"{song['Artist']}|{song['Song']}") for song in accepted_songs)
    rejected_keys = set(song.get('Track_Key', f"{song['Artist']}|{song['Song']}") for song in rejected_songs)
    for i, song in enumerate(current_batch, start=current_index + 1):
        track_key = song.get('Track_Key', f"{song['Artist']}|{song['Song']}")
        already_selected = track_key in accepted_keys
        already_rejected = track_key in rejected_keys
        source_text = " [Uploaded CSV]" if song.get('Source') == 'Uploaded CSV' else ""

        select_disabled = already_selected or already_rejected
        reject_disabled = already_selected or already_rejected
        select_label = 'Selected' if already_selected else ('Unavailable' if already_rejected else 'Select')
        reject_label = 'Rejected' if already_rejected else 'Reject'

        batch_html.append(html.Div([
            html.P(f"{i}. {song['Song']} — {song['Artist']} ({song['Album_Year']}){source_text}", style={'fontSize': '18px', 'fontWeight': 'bold', 'marginBottom': '2px'}),
            html.P(f"Distance: {song['distance']:.4f}", style={'marginBottom': '6px'}),
            html.P(f"Features: BPM={song['BPM']}, Mood Score={song['mood_score']:.1f}, Key Step={int(song['key_step'])}", style={'marginBottom': '4px'}),
            html.P(f"Core Features: BPM={song['BPM']}, Valence={song['Valence']}, Energy={song['Energy']}, Dance={song['Dance']}, Key={song['Camelot']}", style={'marginBottom': '8px'}),
            html.Div([
                html.Button(
                    select_label,
                    id={'type': 'pb-select-song', 'index': i - 1},
                    n_clicks=0,
                    disabled=select_disabled,
                    style={'marginRight': '8px', 'marginBottom': '10px', 'backgroundColor': '#4CAF50' if not select_disabled else '#9E9E9E', 'color': 'white', 'border': 'none', 'padding': '8px 16px'}
                ),
                html.Button(
                    reject_label,
                    id={'type': 'pb-reject-song', 'index': i - 1},
                    n_clicks=0,
                    disabled=reject_disabled,
                    style={'marginBottom': '10px', 'backgroundColor': '#f44336' if not reject_disabled else '#9E9E9E', 'color': 'white', 'border': 'none', 'padding': '8px 16px'}
                ),
            ]),
            html.Hr()
        ]))

    prev_disabled = current_index <= 0
    next_disabled = batch_end >= len(knn_results)
    prev_style = prev_style_visible if current_index > 0 else hidden_style
    next_style = next_style_visible if not next_disabled else hidden_style
    return html.Div(batch_html), prev_disabled, next_disabled, prev_style, next_style

@app.callback(
    Output('pb-accepted-songs', 'data', allow_duplicate=True),
    Input({'type': 'pb-select-song', 'index': dash.dependencies.ALL}, 'n_clicks'),
    State('pb-knn-results', 'data'),
    State('pb-current-index', 'data'),
    State('pb-accepted-songs', 'data'),
    State('pb-target-size', 'value'),
    prevent_initial_call=True
)
def select_song_from_batch(n_clicks_list, knn_results, current_index, accepted_songs, target_size):
    if not knn_results or current_index >= len(knn_results):
        return accepted_songs

    if accepted_songs is None:
        accepted_songs = []

    if not target_size:
        target_size = 50

    triggered = dash.callback_context.triggered
    if not triggered:
        return accepted_songs
    if not triggered[0].get('value'):
        return accepted_songs

    import json
    triggered_id = triggered[0]['prop_id'].split('.')[0]
    try:
        triggered_id = json.loads(triggered_id)
    except Exception:
        return accepted_songs

    selected_index = triggered_id.get('index')
    if not isinstance(selected_index, int) or selected_index < 0 or selected_index >= len(knn_results):
        return accepted_songs

    if len(accepted_songs) >= (target_size - 1):
        return accepted_songs

    selected_song = knn_results[selected_index]
    selected_track_key = selected_song.get('Track_Key', f"{selected_song['Artist']}|{selected_song['Song']}")

    accepted_keys = set(song.get('Track_Key', f"{song['Artist']}|{song['Song']}") for song in accepted_songs)
    if selected_track_key in accepted_keys:
        return accepted_songs

    new_accepted = accepted_songs.copy()
    new_accepted.append(selected_song)
    return new_accepted

@app.callback(
    Output('pb-rejected-songs', 'data', allow_duplicate=True),
    Input({'type': 'pb-reject-song', 'index': dash.dependencies.ALL}, 'n_clicks'),
    State('pb-knn-results', 'data'),
    State('pb-current-index', 'data'),
    State('pb-rejected-songs', 'data'),
    State('pb-accepted-songs', 'data'),
    prevent_initial_call=True
)
def reject_song_from_batch(n_clicks_list, knn_results, current_index, rejected_songs, accepted_songs):
    if not knn_results or current_index >= len(knn_results):
        return rejected_songs

    if rejected_songs is None:
        rejected_songs = []
    if accepted_songs is None:
        accepted_songs = []

    triggered = dash.callback_context.triggered
    if not triggered:
        return rejected_songs
    if not triggered[0].get('value'):
        return rejected_songs

    import json
    triggered_id = triggered[0]['prop_id'].split('.')[0]
    try:
        triggered_id = json.loads(triggered_id)
    except Exception:
        return rejected_songs

    rejected_index = triggered_id.get('index')
    if not isinstance(rejected_index, int) or rejected_index < 0 or rejected_index >= len(knn_results):
        return rejected_songs

    rejected_song = knn_results[rejected_index]
    rejected_track_key = rejected_song.get('Track_Key', f"{rejected_song['Artist']}|{rejected_song['Song']}")

    accepted_keys = set(song.get('Track_Key', f"{song['Artist']}|{song['Song']}") for song in accepted_songs)
    rejected_keys = set(song.get('Track_Key', f"{song['Artist']}|{song['Song']}") for song in rejected_songs)
    if rejected_track_key in accepted_keys or rejected_track_key in rejected_keys:
        return rejected_songs

    new_rejected = rejected_songs.copy()
    new_rejected.append(rejected_song)
    return new_rejected

@app.callback(
    Output('pb-uploaded-songs', 'data'),
    Output('pb-upload-status', 'children'),
    Input('pb-upload-csv', 'contents'),
    State('pb-upload-csv', 'filename'),
    prevent_initial_call=True
)
def parse_uploaded_csv(contents, filename):
    if not contents:
        return [], html.Div()

    try:
        _, content_string = contents.split(',', 1)
        decoded = base64.b64decode(content_string)
        df_upload = pd.read_csv(io.StringIO(decoded.decode('utf-8')))

        normalized_cols = {col: col.strip().lower() for col in df_upload.columns}
        df_upload = df_upload.rename(columns=normalized_cols)

        required_numeric = ['bpm', 'valence', 'dance', 'energy']
        required_text = ['song', 'artist']
        if not all(col in df_upload.columns for col in required_numeric + required_text):
            return [], html.Div("Upload failed: CSV must include Song, Artist, BPM, Valence, Dance, and Energy columns.", style={'color': '#f44336'})

        camelot_col = 'camelot' if 'camelot' in df_upload.columns else ('key' if 'key' in df_upload.columns else None)
        if camelot_col is None:
            return [], html.Div("Upload failed: CSV must include either Camelot or Key column.", style={'color': '#f44336'})

        for col in required_numeric:
            df_upload[col] = pd.to_numeric(df_upload[col], errors='coerce')

        df_upload['song'] = df_upload['song'].astype(str).str.strip()
        df_upload['artist'] = df_upload['artist'].astype(str).str.strip()
        df_upload['camelot_norm'] = df_upload[camelot_col].astype(str).str.strip()

        df_upload = df_upload.dropna(subset=required_numeric)
        df_upload = df_upload[(df_upload['song'] != '') & (df_upload['artist'] != '') & (df_upload['camelot_norm'] != '')]

        if df_upload.empty:
            return [], html.Div("Upload failed: no valid rows after validation.", style={'color': '#f44336'})

        upload_records = []
        for _, row in df_upload.iterrows():
            upload_records.append({
                'Track_Key': f"{row['artist']}|{row['song']}",
                'Track_ID': row['track_id'] if 'track_id' in row and pd.notna(row['track_id']) else '',
                'Song': row['song'],
                'Artist': row['artist'],
                'Album': row['album'] if 'album' in row and pd.notna(row['album']) else '',
                'Album_Year': row['year'] if 'year' in row and pd.notna(row['year']) else None,
                'Popularity': row['popularity'] if 'popularity' in row and pd.notna(row['popularity']) else None,
                'Camelot': row['camelot_norm'],
                'BPM': row['bpm'],
                'Valence': row['valence'],
                'Dance': row['dance'],
                'Energy': row['energy'],
                'Source': 'Uploaded CSV'
            })

        df_records = pd.DataFrame(upload_records)
        df_records = df_records.drop_duplicates(subset=['Track_Key'], keep='first')
        records = df_records.to_dict('records')

        preview_items = [
            html.Li(f"{row['Song']} — {row['Artist']}")
            for row in records[:5]
        ]
        more_text = f" (+{len(records) - 5} more)" if len(records) > 5 else ""

        return records, html.Div([
            html.P(f"Loaded {len(records)} uploaded songs from {filename} (session only).", style={'margin': '0', 'fontWeight': 'bold', 'color': '#2e7d32'}),
            html.P("These songs are available in Playlist Builder candidate results.", style={'margin': '4px 0 0 0', 'fontStyle': 'italic'}),
            html.Ul(preview_items, style={'margin': '6px 0 0 18px'}),
            html.P(more_text, style={'margin': '2px 0 0 0'}) if more_text else html.Div()
        ])

    except Exception as e:
        import traceback
        traceback.print_exc()
        return [], html.Div(f"Upload failed: {str(e)}", style={'color': '#f44336'})

@app.callback(
    Output('pb-song-dropdown', 'options'),
    Input('pb-uploaded-songs', 'data')
)
def update_seed_song_options(uploaded_songs_data):
    options = list(song_options)

    if not uploaded_songs_data:
        return options

    existing_values = {opt.get('value') for opt in options}
    for song in uploaded_songs_data:
        artist = str(song.get('Artist', '')).strip()
        title = str(song.get('Song', '')).strip()
        if not artist or not title:
            continue

        value = f"{artist}|{title}"
        if value in existing_values:
            continue

        options.append({
            'label': f"{artist} - {title} [Uploaded CSV]",
            'value': value
        })
        existing_values.add(value)

    return options

@app.callback(
    Output('pb-current-index', 'data', allow_duplicate=True),
    Input('pb-next-batch-button', 'n_clicks'),
    State('pb-current-index', 'data'),
    State('pb-knn-results', 'data'),
    prevent_initial_call=True
)
def next_batch(n_clicks, current_index, knn_results):
    if not knn_results or current_index >= len(knn_results):
        return current_index

    return min(current_index + 10, len(knn_results))

@app.callback(
    Output('pb-current-index', 'data', allow_duplicate=True),
    Input('pb-prev-batch-button', 'n_clicks'),
    State('pb-current-index', 'data'),
    prevent_initial_call=True
)
def previous_batch(n_clicks, current_index):
    if current_index <= 0:
        return 0

    return max(current_index - 10, 0)

@app.callback(
    Output('pb-progress', 'children'),
    Output('pb-playlist', 'children'),
    Output('pb-export-button', 'disabled'),
    Output('pb-save-db-button', 'disabled'),
    Input('pb-accepted-songs', 'data'),
    Input('pb-rejected-songs', 'data'),
    Input('pb-target-size', 'value'),
    State('pb-song-dropdown', 'value')
)
def update_progress_playlist(accepted_songs, rejected_songs, target_size, seed_song_artist):
    if accepted_songs is None:
        accepted_songs = []
    if rejected_songs is None:
        rejected_songs = []

    if not target_size:
        target_size = 50

    if not accepted_songs:
        if seed_song_artist:
            return html.Div(f"Progress: 1/{target_size} songs (Seed song selected)"), html.Div(), True, True
        return html.Div(f"Progress: 0/{target_size} songs"), html.Div(), True, True
    
    current_count = 1 + len(accepted_songs)  # Seed song + accepted songs
    progress_text = f"Progress: {current_count}/{target_size} songs"
    
    is_complete = current_count >= target_size
    if is_complete:
        progress_text += " - Playlist Complete!"
    
    # Build playlist display
    playlist_html = [
        html.H3("Current Playlist:"),
        html.Hr()
    ]
    
    # Add seed song
    if seed_song_artist:
        seed_artist, seed_song = seed_song_artist.split('|')
        playlist_html.append(html.Div([
            html.P(f"1. {seed_song} — {seed_artist} [SEED]", style={'fontWeight': 'bold', 'color': '#4CAF50'}),
            html.Hr()
        ]))
    
    # Add accepted songs
    for accepted_idx, song in enumerate(accepted_songs):
        display_num = accepted_idx + 2
        move_up_disabled = accepted_idx == 0
        move_down_disabled = accepted_idx == len(accepted_songs) - 1
        playlist_html.append(html.Div([
            html.P(f"{display_num}. {song['Song']} — {song['Artist']} ({song['Album_Year']})", style={'fontWeight': 'bold'}),
            html.P(f"   Distance: {song['distance']:.4f}"),
            html.P(f"   Features: BPM={song['BPM']}, Mood Score={song['mood_score']:.1f}, Key Step={int(song['key_step'])}"),
            html.P(f"   Core Features: BPM={song['BPM']}, Valence={song['Valence']}, Energy={song['Energy']}, Dance={song['Dance']}, Key={song['Camelot']}"),
            html.Div([
                html.Button(
                    'Up',
                    id={'type': 'pb-move-up', 'index': accepted_idx},
                    n_clicks=0,
                    disabled=move_up_disabled,
                    style={'marginRight': '8px', 'backgroundColor': '#1E88E5', 'color': 'white', 'border': 'none', 'padding': '6px 12px'}
                ),
                html.Button(
                    'Down',
                    id={'type': 'pb-move-down', 'index': accepted_idx},
                    n_clicks=0,
                    disabled=move_down_disabled,
                    style={'backgroundColor': '#7C4DFF', 'color': 'white', 'border': 'none', 'padding': '6px 12px'}
                ),
                html.Button(
                    'Remove',
                    id={'type': 'pb-remove-accepted', 'index': accepted_idx},
                    n_clicks=0,
                    style={'marginLeft': '8px', 'backgroundColor': '#f44336', 'color': 'white', 'border': 'none', 'padding': '6px 12px'}
                )
            ], style={'marginBottom': '8px'}),
            html.Hr()
        ]))

    # Add rejected songs section
    if rejected_songs:
        playlist_html.append(html.H3("Rejected Songs:"))
        playlist_html.append(html.Hr())
        for song in rejected_songs:
            playlist_html.append(html.Div([
                html.P(f"{song['Song']} — {song['Artist']} ({song['Album_Year']})", style={'fontWeight': 'bold', 'color': '#f44336'}),
                html.P(f"   Distance: {song['distance']:.4f}"),
                html.P(f"   Features: BPM={song['BPM']}, Mood Score={song['mood_score']:.1f}, Key Step={int(song['key_step'])}"),
                html.P(f"   Core Features: BPM={song['BPM']}, Valence={song['Valence']}, Energy={song['Energy']}, Dance={song['Dance']}, Key={song['Camelot']}"),
                html.Button(
                    'Add',
                    id={'type': 'pb-add-rejected', 'index': f"{song['Artist']}|{song['Song']}"},
                    n_clicks=0,
                    style={'marginBottom': '8px', 'backgroundColor': '#4CAF50', 'color': 'white', 'border': 'none', 'padding': '6px 12px'}
                ),
                html.Hr()
            ]))
    
    return html.Div(progress_text, style={'fontWeight': 'bold'}), html.Div(playlist_html), not is_complete, not is_complete

@app.callback(
    Output('pb-accepted-songs', 'data', allow_duplicate=True),
    Input({'type': 'pb-move-up', 'index': dash.dependencies.ALL}, 'n_clicks'),
    Input({'type': 'pb-move-down', 'index': dash.dependencies.ALL}, 'n_clicks'),
    State('pb-accepted-songs', 'data'),
    prevent_initial_call=True
)
def reorder_accepted_songs(move_up_clicks, move_down_clicks, accepted_songs):
    if not accepted_songs or len(accepted_songs) < 2:
        return accepted_songs

    triggered = dash.callback_context.triggered
    if not triggered:
        return accepted_songs
    if not triggered[0].get('value'):
        return accepted_songs

    import json
    triggered_id = triggered[0]['prop_id'].split('.')[0]
    try:
        triggered_id = json.loads(triggered_id)
    except Exception:
        return accepted_songs

    move_type = triggered_id.get('type')
    idx = triggered_id.get('index')
    if not isinstance(idx, int):
        return accepted_songs

    new_accepted = accepted_songs.copy()
    if move_type == 'pb-move-up' and idx > 0:
        new_accepted[idx - 1], new_accepted[idx] = new_accepted[idx], new_accepted[idx - 1]
    elif move_type == 'pb-move-down' and idx < len(new_accepted) - 1:
        new_accepted[idx], new_accepted[idx + 1] = new_accepted[idx + 1], new_accepted[idx]

    return new_accepted

@app.callback(
    Output('pb-accepted-songs', 'data', allow_duplicate=True),
    Output('pb-rejected-songs', 'data', allow_duplicate=True),
    Input({'type': 'pb-remove-accepted', 'index': dash.dependencies.ALL}, 'n_clicks'),
    State('pb-accepted-songs', 'data'),
    State('pb-rejected-songs', 'data'),
    prevent_initial_call=True
)
def remove_accepted_song(n_clicks_list, accepted_songs, rejected_songs):
    if not accepted_songs:
        return accepted_songs, rejected_songs

    if rejected_songs is None:
        rejected_songs = []

    triggered = dash.callback_context.triggered
    if not triggered:
        return accepted_songs, rejected_songs
    if not triggered[0].get('value'):
        return accepted_songs, rejected_songs

    import json
    triggered_id = triggered[0]['prop_id'].split('.')[0]
    try:
        triggered_id = json.loads(triggered_id)
    except Exception:
        return accepted_songs, rejected_songs

    idx = triggered_id.get('index')
    if not isinstance(idx, int) or idx < 0 or idx >= len(accepted_songs):
        return accepted_songs, rejected_songs

    new_accepted = accepted_songs.copy()
    removed_song = new_accepted.pop(idx)

    removed_key = removed_song.get('Track_Key', f"{removed_song['Artist']}|{removed_song['Song']}")
    rejected_keys = set(song.get('Track_Key', f"{song['Artist']}|{song['Song']}") for song in rejected_songs)
    new_rejected = rejected_songs.copy()
    if removed_key not in rejected_keys:
        new_rejected.append(removed_song)

    return new_accepted, new_rejected

@app.callback(
    Output('pb-accepted-songs', 'data', allow_duplicate=True),
    Output('pb-rejected-songs', 'data', allow_duplicate=True),
    Input({'type': 'pb-add-rejected', 'index': dash.dependencies.ALL}, 'n_clicks'),
    State('pb-accepted-songs', 'data'),
    State('pb-rejected-songs', 'data'),
    prevent_initial_call=True
)
def add_rejected_song(n_clicks_list, accepted_songs, rejected_songs):
    if rejected_songs is None or not rejected_songs:
        return accepted_songs, rejected_songs

    if accepted_songs is None:
        accepted_songs = []

    triggered = dash.callback_context.triggered
    if not triggered:
        return accepted_songs, rejected_songs
    if not triggered[0].get('value'):
        return accepted_songs, rejected_songs

    import json
    triggered_id = triggered[0]['prop_id'].split('.')[0]
    try:
        triggered_id = json.loads(triggered_id)
    except Exception:
        return accepted_songs, rejected_songs

    track_key = triggered_id.get('index')
    if not track_key:
        return accepted_songs, rejected_songs

    song_to_add = None
    new_rejected = []
    for song in rejected_songs:
        song_key = song.get('Track_Key', f"{song['Artist']}|{song['Song']}")
        if song_key == track_key and song_to_add is None:
            song_to_add = song
        else:
            new_rejected.append(song)

    if song_to_add is None:
        return accepted_songs, rejected_songs

    accepted_keys = set(song.get('Track_Key', f"{song['Artist']}|{song['Song']}") for song in accepted_songs)
    if track_key in accepted_keys:
        return accepted_songs, new_rejected

    new_accepted = accepted_songs.copy()
    new_accepted.append(song_to_add)

    return new_accepted, new_rejected

@app.callback(
    Output('pb-save-status', 'children'),
    Input('pb-save-db-button', 'n_clicks'),
    State('pb-accepted-songs', 'data'),
    State('pb-song-dropdown', 'value'),
    State('pb-playlist-name', 'value'),
    State('pb-target-size', 'value'),
    prevent_initial_call=True
)
def save_playlist_to_db(n_clicks, accepted_songs, seed_song_artist, playlist_name, target_size):
    if not accepted_songs or not seed_song_artist or not playlist_name:
        return html.Div("Please enter a playlist name and complete the playlist first.", style={'color': 'red'})
    
    try:
        from datetime import datetime
        
        seed_artist, seed_song = seed_song_artist.split('|')
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        ensure_custom_playlist_tables(conn)
        
        # Insert playlist metadata
        created_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute('''
            INSERT INTO custom_playlists (playlist_name, seed_song, seed_artist, target_size, created_date)
            VALUES (?, ?, ?, ?, ?)
        ''', (playlist_name, seed_song, seed_artist, target_size, created_date))
        
        playlist_id = cursor.lastrowid
        
        # Get audio features for seed song
        seed_data = pd.read_sql(
            "SELECT Track_Key, Track_ID, Song, Artist, Album, Album_Year, BPM, Valence, Dance, Energy, Camelot FROM tracks WHERE Track_Key = ?",
            conn,
            params=(f"{seed_artist}|{seed_song}",)
        )
        
        # Insert seed song
        if not seed_data.empty:
            row = seed_data.iloc[0]
            seed_mood_score = row['Valence'] + row['Dance'] + row['Energy']
            seed_key_step = build_key_step_lookup(row['Camelot']).get(str(row['Camelot']), 1)
            cursor.execute('''
                INSERT INTO custom_playlist_songs (playlist_id, track_number, track_key, track_id, song, artist, album, year, bpm, valence, dance, energy, key, distance, mood_score, key_step)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (playlist_id, 1, f"{row['Artist']}|{row['Song']}", row['Track_ID'], row['Song'], row['Artist'], row['Album'], row['Album_Year'], row['BPM'], row['Valence'], row['Dance'], row['Energy'], row['Camelot'], 0.0, seed_mood_score, seed_key_step))
        
        # Get audio features for accepted songs
        accepted_track_keys = [f"{song['Artist']}|{song['Song']}" for song in accepted_songs]
        if accepted_track_keys:
            accepted_features = pd.read_sql(
                f"SELECT Track_Key, BPM, Valence, Dance, Energy, Camelot FROM tracks WHERE Track_Key IN ({','.join(['?']*len(accepted_track_keys))})",
                conn,
                params=accepted_track_keys
            )
            accepted_features = accepted_features.set_index('Track_Key')
            
            # Insert accepted songs
            for i, song in enumerate(accepted_songs, 2):
                track_key = f"{song['Artist']}|{song['Song']}"
                if track_key in accepted_features.index:
                    features = accepted_features.loc[track_key]
                    mood_score = features['Valence'] + features['Dance'] + features['Energy']
                    key_step = int(song.get('key_step', build_key_step_lookup(features['Camelot']).get(str(features['Camelot']), len(HARMONIC_RULE_GROUPS) + 1)))
                    cursor.execute('''
                        INSERT INTO custom_playlist_songs (playlist_id, track_number, track_key, track_id, song, artist, album, year, bpm, valence, dance, energy, key, distance, mood_score, key_step)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (playlist_id, i, track_key, song['Track_ID'], song['Song'], song['Artist'], song['Album'], song['Album_Year'], features['BPM'], features['Valence'], features['Dance'], features['Energy'], features['Camelot'], song['distance'], mood_score, key_step))
                else:
                    bpm = float(song.get('BPM', 0) or 0)
                    valence = float(song.get('Valence', 0) or 0)
                    dance = float(song.get('Dance', 0) or 0)
                    energy = float(song.get('Energy', 0) or 0)
                    camelot = song.get('Camelot', '')
                    mood_score = valence + dance + energy
                    key_step = int(song.get('key_step', build_key_step_lookup(camelot).get(str(camelot), len(HARMONIC_RULE_GROUPS) + 1)))
                    cursor.execute('''
                        INSERT INTO custom_playlist_songs (playlist_id, track_number, track_key, track_id, song, artist, album, year, bpm, valence, dance, energy, key, distance, mood_score, key_step)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        playlist_id,
                        i,
                        track_key,
                        song.get('Track_ID', ''),
                        song['Song'],
                        song['Artist'],
                        song.get('Album', ''),
                        song.get('Album_Year'),
                        bpm,
                        valence,
                        dance,
                        energy,
                        camelot,
                        float(song.get('distance', 0.0) or 0.0),
                        mood_score,
                        key_step
                    ))
        
        conn.commit()
        conn.close()
        
        return html.Div(f"Playlist '{playlist_name}' saved to database successfully!", style={'color': 'green', 'fontWeight': 'bold'})
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return html.Div(f"Error saving playlist: {str(e)}", style={'color': 'red'})

@app.callback(
    Output('pb-key-results', 'children'),
    Input('pb-key-dropdown', 'value')
)
def show_songs_by_key(selected_key):
    if not selected_key:
        return html.P("Select a key to view songs.")

    try:
        conn = sqlite3.connect(db_path)
        df_key_songs = pd.read_sql(
            """
            SELECT Song, Artist, Album, Album_Year, BPM, Valence, Energy, Dance
            FROM tracks
            WHERE Camelot = ?
            ORDER BY Artist, Song
            """,
            conn,
            params=(selected_key,)
        )
        conn.close()

        if df_key_songs.empty:
            return html.P(f"No songs found for key {selected_key}.")

        return html.Div([
            html.P(f"Found {len(df_key_songs)} songs in key {selected_key}.", style={'fontWeight': 'bold'}),
            dash.dash_table.DataTable(
                data=df_key_songs.to_dict('records'),
                columns=[{"name": col, "id": col} for col in df_key_songs.columns],
                page_size=20,
                sort_action='native',
                style_table={'overflowX': 'auto'},
                style_cell={'textAlign': 'left', 'padding': '6px'},
                style_header={'fontWeight': 'bold'}
            )
        ])

    except Exception as e:
        import traceback
        traceback.print_exc()
        return html.Div(f"Error loading songs by key: {str(e)}", style={'color': '#f44336'})

@app.callback(
    Output('pb-download', 'data'),
    Input('pb-export-button', 'n_clicks'),
    State('pb-accepted-songs', 'data'),
    State('pb-song-dropdown', 'value'),
    prevent_initial_call=True
)
def export_playlist(n_clicks, accepted_songs, seed_song_artist):
    if not accepted_songs or not seed_song_artist:
        return None
    
    import io
    import csv
    
    seed_artist, seed_song = seed_song_artist.split('|')
    
    # Generate filename: snap_out_of_it.csv
    seed_song_filename = seed_song.lower().replace(' ', '_').replace('?', '').replace('!', '').replace('.', '')
    filename = f"{seed_song_filename}.csv"
    
    # Get seed song data from database
    conn = sqlite3.connect(db_path)
    ensure_custom_playlist_tables(conn)
    seed_data = pd.read_sql(
        "SELECT Track_ID, Song, Artist, Album, Album_Year, BPM, Valence, Dance, Energy, Camelot FROM tracks WHERE Track_Key = ?",
        conn,
        params=(f"{seed_artist}|{seed_song}",)
    )
    
    # Get audio features for accepted songs
    accepted_track_keys = [f"{song['Artist']}|{song['Song']}" for song in accepted_songs]
    if accepted_track_keys:
        accepted_features = pd.read_sql(
            f"SELECT Track_Key, BPM, Valence, Dance, Energy, Camelot FROM tracks WHERE Track_Key IN ({','.join(['?']*len(accepted_track_keys))})",
            conn,
            params=accepted_track_keys
        )
        accepted_features = accepted_features.set_index('Track_Key')
    else:
        accepted_features = pd.DataFrame()
    
    conn.close()
    
    # Create CSV content
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Track_Number', 'Track_Key', 'Track_ID', 'Song', 'Artist', 'Album', 'Year', 'Distance', 'BPM', 'Valence', 'Energy', 'Dance', 'Key', 'Mood_Score', 'Key_Step'])
    
    # Write seed song
    if not seed_data.empty:
        row = seed_data.iloc[0]
        seed_mood_score = row['Valence'] + row['Dance'] + row['Energy']
        seed_key_step = build_key_step_lookup(row['Camelot']).get(str(row['Camelot']), 1)
        writer.writerow([1, f"{row['Artist']}|{row['Song']}", row['Track_ID'], row['Song'], row['Artist'], row['Album'], row['Album_Year'], 0.0000, row['BPM'], row['Valence'], row['Energy'], row['Dance'], row['Camelot'], seed_mood_score, seed_key_step])
    
    # Write accepted songs
    for i, song in enumerate(accepted_songs, 2):
        track_key = f"{song['Artist']}|{song['Song']}"
        if track_key in accepted_features.index:
            features = accepted_features.loc[track_key]
            mood_score = features['Valence'] + features['Dance'] + features['Energy']
            key_step = int(song.get('key_step', build_key_step_lookup(features['Camelot']).get(str(features['Camelot']), len(HARMONIC_RULE_GROUPS) + 1)))
            writer.writerow([i, track_key, song['Track_ID'], song['Song'], song['Artist'], song['Album'], song['Album_Year'], song['distance'], features['BPM'], features['Valence'], features['Energy'], features['Dance'], features['Camelot'], mood_score, key_step])
        else:
            bpm = float(song.get('BPM', 0) or 0)
            valence = float(song.get('Valence', 0) or 0)
            energy = float(song.get('Energy', 0) or 0)
            dance = float(song.get('Dance', 0) or 0)
            camelot = song.get('Camelot', '')
            mood_score = valence + dance + energy
            key_step = int(song.get('key_step', build_key_step_lookup(camelot).get(str(camelot), len(HARMONIC_RULE_GROUPS) + 1)))
            writer.writerow([i, track_key, song.get('Track_ID', ''), song['Song'], song['Artist'], song.get('Album', ''), song.get('Album_Year'), song.get('distance', 0.0), bpm, valence, energy, dance, camelot, mood_score, key_step])
    
    output.seek(0)
    
    return dict(content=output.getvalue(), filename=filename, type='text/csv')

if __name__ == '__main__':
    app.run(debug=True)
